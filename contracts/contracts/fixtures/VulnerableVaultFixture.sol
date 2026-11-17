// SPDX-License-Identifier: MIT
// TEST FIXTURE ONLY — DO NOT DEPLOY TO AVALANCHE FUJI OR MAINNET.
// DO NOT FUND WITH REAL OR TESTNET AVAX.
pragma solidity ^0.8.0;

/**
 * @title VulnerableVaultFixture
 * @notice Intentionally vulnerable contract fixture for isolated local security testing
 *         and triage rule validation.
 * @dev Demonstrates multiple risk tiers:
 *      1. CRITICAL: Unchecked Reentrancy in withdraw() (external, no guard, CEI violation)
 *      2. CRITICAL: Missing Access Control in emergencyDrain() (public, no onlyOwner)
 *      3. MEDIUM:   tx.origin authentication anti-pattern in adminSweepFee()
 *      4. LOW:      Floating pragma (^0.8.0)
 */
contract VulnerableVaultFixture {
    address public owner;
    mapping(address => uint256) public balances;
    uint256 public protocolFee;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event EmergencyDrained(address indexed caller, address indexed recipient, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @dev VULN-001 (CRITICAL): Sends native asset before updating balances[msg.sender].
     *      Publicly callable (external), no ReentrancyGuard.
     */
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        unchecked {
            balances[msg.sender] -= amount;
        }
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev VULN-002 (CRITICAL): Missing access control (no onlyOwner modifier).
     *      Any external caller can drain the entire contract balance.
     */
    function emergencyDrain(address payable recipient) public {
        require(recipient != address(0), "Zero recipient");
        uint256 contractBalance = address(this).balance;
        (bool success, ) = recipient.call{value: contractBalance}("");
        require(success, "Drain failed");
        emit EmergencyDrained(msg.sender, recipient, contractBalance);
    }

    /**
     * @dev VULN-003 (MEDIUM): Uses tx.origin instead of msg.sender for authorization.
     */
    function setProtocolFee(uint256 newFee) external {
        require(tx.origin == owner, "Not owner via tx.origin");
        protocolFee = newFee;
    }

    receive() external payable {
        balances[msg.sender] += msg.value;
    }
}


// SPDX-License-Identifier: MIT
// TEST FIXTURE ONLY — Reference remediated vault for false-positive & exposure testing.
pragma solidity 0.8.20;

/**
 * @title SafeVaultFixture
 * @notice Remediated vault demonstrating Checks-Effects-Interactions, Reentrancy lock,
 *         strict msg.sender access control, and pause circuit-breaker.
 */
contract SafeVaultFixture {
    address public owner;
    bool public paused;
    uint256 private _locked = 1;
    mapping(address => uint256) public balances;

    error NotOwner();
    error ContractPaused();
    error ReentrancyBlocked();
    error ZeroAddress();
    error InsufficientBalance();
    error TransferFailed();

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event EmergencyDrained(address indexed owner, address indexed recipient, uint256 amount);
    event PauseToggled(bool paused);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert ReentrancyBlocked();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor() {
        owner = msg.sender;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function deposit() external payable whenNotPaused {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        uint256 bal = balances[msg.sender];
        if (bal < amount) revert InsufficientBalance();

        // Effects before Interactions
        balances[msg.sender] = bal - amount;
        emit Withdrawn(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function emergencyDrain(address payable recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 contractBalance = address(this).balance;
        (bool success, ) = recipient.call{value: contractBalance}("");
        if (!success) revert TransferFailed();
        emit EmergencyDrained(msg.sender, recipient, contractBalance);
    }
}


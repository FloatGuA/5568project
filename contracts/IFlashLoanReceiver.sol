// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFlashLoanReceiver
 * @notice Interface that flash loan receivers must implement.
 *
 * The receiver contract must:
 *  1. Receive `amount` tokens from LendingPool.
 *  2. Execute arbitrary logic (arbitrage, liquidation, etc.).
 *  3. Approve LendingPool to pull back `amount + fee` before returning.
 *  4. Return `true` to signal success.
 *
 * If the pool balance does not increase by at least `fee` after the call,
 * the entire transaction reverts.
 */
interface IFlashLoanReceiver {
    /**
     * @param token    The ERC-20 token that was flash-loaned.
     * @param amount   The amount that was sent to this contract.
     * @param fee      The fee that must be repaid on top of `amount`.
     * @param data     Arbitrary encoded data forwarded from the flash loan caller.
     * @return         Must return `true`; any other value causes the tx to revert.
     */
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}

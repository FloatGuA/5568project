// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IFlashLoanReceiver.sol";

/**
 * @title MockFlashLoanReceiver
 * @notice Test helper that receives a flash loan, records the call parameters,
 *         and repays amount + fee by approving the pool to pull funds back.
 *
 *         Set `shouldRepay = false` to simulate a receiver that fails to repay.
 */
contract MockFlashLoanReceiver is IFlashLoanReceiver {
    address public pool;

    bool    public shouldRepay = true;
    bool    public wasCalled;
    address public lastToken;
    uint256 public lastAmount;
    uint256 public lastFee;
    bytes   public lastData;

    constructor(address _pool) {
        pool = _pool;
    }

    /// @notice Toggle whether this receiver will repay the loan.
    function setShouldRepay(bool value) external {
        shouldRepay = value;
    }

    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external override returns (bool) {
        require(msg.sender == pool, "Only pool can call");

        wasCalled  = true;
        lastToken  = token;
        lastAmount = amount;
        lastFee    = fee;
        lastData   = data;

        if (shouldRepay) {
            // Approve the pool to pull amount + fee back
            IERC20(token).approve(pool, amount + fee);
        }
        // If shouldRepay == false, we do NOT approve → pool's transferFrom will revert

        return true;
    }
}

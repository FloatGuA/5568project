// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockWETH
 * @notice Simulated Wrapped ETH token for the lending protocol demo.
 *         Anyone can mint (faucet) for testing purposes.
 *         Price is treated as $2000 USD in the lending pool.
 */
contract MockWETH is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10 * 1e18; // 10 WETH per claim

    constructor() ERC20("Wrapped ETH", "WETH") Ownable(msg.sender) {}

    /// @notice Owner can mint tokens to any address (for initial setup)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Anyone can claim 10 WETH for testing
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Stablecoin (C5D)
 * @notice Simulated stablecoin pegged to USD (1 C5D = $1).
 *         Owner can mint, and anyone can use the faucet for testing.
 */
contract Stablecoin is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1000 * 1e18; // 1000 C5D per claim

    constructor() ERC20("COMP5521 Dollar", "C5D") Ownable(msg.sender) {}

    /// @notice Owner can mint stablecoins to any address
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Anyone can claim 1000 C5D for testing
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}

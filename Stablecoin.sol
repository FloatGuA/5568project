// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// Stablecoin contract for the marketplace
contract Stablecoin is ERC20, Ownable {
    constructor() ERC20("COMP5521 Dollar", "C5D") Ownable(msg.sender) {}

    /// Only owner can mint stablecoins (simulates 1:1 peg to HKD)
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}

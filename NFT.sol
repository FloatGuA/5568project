// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// NFT contract for digital collectibles
contract NFT is ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;

    constructor() ERC721("COMP5521 NFT", "C5D-NFT") Ownable(msg.sender) {}

    /// Only owner can mint NFTs with metadata
    function safeMint(address to, string memory tokenURI) public onlyOwner {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter += 1;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
    }


}

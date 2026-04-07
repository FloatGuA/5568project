// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract Marketplace is IERC721Receiver {
    IERC20 public stablecoin;

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    mapping(address => mapping(uint256 => Listing)) public listings;

    event Listed(address indexed nftContract, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Sold(address indexed nftContract, uint256 indexed tokenId, address indexed buyer, uint256 price);
    event Cancelled(address indexed nftContract, uint256 indexed tokenId, address indexed seller);

    constructor(address _stablecoin) {
        stablecoin = IERC20(_stablecoin);
    }

    function listNFT(address nftContract, uint256 tokenId, uint256 price) public {
        require(price > 0, "Price must be greater than 0");
        require(IERC721(nftContract).ownerOf(tokenId) == msg.sender, "Not the owner");
        require(!listings[nftContract][tokenId].active, "Already listed");

        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

        listings[nftContract][tokenId] = Listing({
            seller: msg.sender,
            price: price,
            active: true
        });

        emit Listed(nftContract, tokenId, msg.sender, price);
    }

    function buyNFT(address nftContract, uint256 tokenId) public {
        Listing storage listing = listings[nftContract][tokenId];
        require(listing.active, "NFT not listed");

        address seller = listing.seller;
        uint256 price = listing.price;

        delete listings[nftContract][tokenId];

        require(stablecoin.transferFrom(msg.sender, seller, price), "Payment failed");
        IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);

        emit Sold(nftContract, tokenId, msg.sender, price);
    }

    function cancelListing(address nftContract, uint256 tokenId) public {
        Listing storage listing = listings[nftContract][tokenId];
        require(listing.active, "NFT not listed");
        require(listing.seller == msg.sender, "Not the seller");

        delete listings[nftContract][tokenId];
        IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);

        emit Cancelled(nftContract, tokenId, msg.sender);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
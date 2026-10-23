// SPDX-License-Identifier: UNLICENSED
// AMOY EXPERIMENT ONLY: no game assets, licenses, payments or production rights.
pragma solidity 0.8.37;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AmoyReader721Pilot is ERC721 {
    uint256 public constant AMOY_CHAIN_ID = 80002;
    address public immutable mintOperator;

    error UnsupportedChain(uint256 chainId);
    error InvalidMintOperator();
    error UnauthorizedMinter(address caller);

    constructor(address operator_) ERC721("Marea Negra Amoy Reader Test", "MNTEST") {
        if (block.chainid != AMOY_CHAIN_ID) revert UnsupportedChain(block.chainid);
        if (operator_ == address(0)) revert InvalidMintOperator();
        mintOperator = operator_;
    }

    function mint(address to, uint256 tokenId) external {
        if (block.chainid != AMOY_CHAIN_ID) revert UnsupportedChain(block.chainid);
        if (msg.sender != mintOperator) revert UnauthorizedMinter(msg.sender);
        _safeMint(to, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return "data:application/json;base64,eyJuYW1lIjoiUHJ1ZWJhIGRlIGxlY3RvciBNQVJFQSBORUdSQSAtIEFtb3kiLCJkZXNjcmlwdGlvbiI6IlRva2VuIGV4cGVyaW1lbnRhbCBkZSB0ZXN0bmV0LiBObyByZXByZXNlbnRhIGVxdWlwbywgdGllcnJhLCBsaWNlbmNpYSwgcGFnbyBuaSBwZXJtaXNvIGRlIGp1ZWdvLiJ9";
    }
}

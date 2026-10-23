// SPDX-License-Identifier: UNLICENSED
// TEST ONLY: Never deploy these unrestricted fixtures to a public network.
pragma solidity 0.8.37;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract Reader721Fixture is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function fixtureMint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function fixtureBurn(uint256 tokenId) external {
        _burn(tokenId);
    }
}

contract Reader1155Fixture is ERC1155 {
    constructor() ERC1155("") {}

    function fixtureMint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}

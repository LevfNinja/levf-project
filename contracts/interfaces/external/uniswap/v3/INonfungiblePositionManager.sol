// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC721/IERC721Metadata.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Enumerable.sol";

// https://docs.uniswap.org/reference/periphery/NonfungiblePositionManager
// https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v3.4.1-solc-0.7-2/contracts/token/ERC721
// https://github.com/Uniswap/uniswap-v3-periphery/blob/v1.0.0/contracts/interfaces/INonfungiblePositionManager.sol
interface INonfungiblePositionManager is IERC721Metadata, IERC721Enumerable {
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

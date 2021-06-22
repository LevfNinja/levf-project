// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;

interface IOldTreasuryPoolMock {
    function lfiAddress() external view returns (address);

    function underlyingAssetAddress() external view returns (address);

    function ltokenAddress() external view returns (address);

    function teamAccount() external view returns (address);

    function dsecDistributionAddress() external view returns (address);

    function totalUnderlyingAssetAmount() external view returns (uint256);

    function totalLtokenAmount() external view returns (uint256);

    function paused() external view returns (bool);
}

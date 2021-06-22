// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;

import "./interfaces/IOldTreasuryPoolMock.sol";

contract NewTreasuryPoolMock {
    address public lfiAddress;
    address public underlyingAssetAddress;
    address public ltokenAddress;
    address public teamAccount;
    address public dsecDistributionAddress;

    uint256 public totalUnderlyingAssetAmount;
    uint256 public totalLtokenAmount;

    constructor(address oldTreasuryPoolAddress_) {
        IOldTreasuryPoolMock oldTreasuryPool =
            IOldTreasuryPoolMock(oldTreasuryPoolAddress_);
        require(oldTreasuryPool.paused(), "migrate while not paused");

        lfiAddress = oldTreasuryPool.lfiAddress();
        underlyingAssetAddress = oldTreasuryPool.underlyingAssetAddress();
        ltokenAddress = oldTreasuryPool.ltokenAddress();
        teamAccount = oldTreasuryPool.teamAccount();
        dsecDistributionAddress = oldTreasuryPool.dsecDistributionAddress();
        totalUnderlyingAssetAmount = oldTreasuryPool
            .totalUnderlyingAssetAmount();
        totalLtokenAmount = oldTreasuryPool.totalLtokenAmount();
    }
}

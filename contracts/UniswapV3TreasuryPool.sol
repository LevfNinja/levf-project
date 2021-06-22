// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./libraries/AddressArray.sol";
import "./interfaces/external/uniswap/v3/INonfungiblePositionManager.sol";
import "./interfaces/ILfi.sol";
import "./interfaces/ILtoken.sol";
import "./interfaces/IDsecDistribution.sol";
import "./interfaces/IFarmingPool.sol";
import "./interfaces/ITreasuryPool.sol";

contract UniswapV3TreasuryPool is
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ITreasuryPool
{
    using SafeMathUpgradeable for uint256;
    using AddressArray for address[];

    uint256 public lpRewardPerEpoch;
    uint256 public teamRewardPerEpoch;
    address public teamAccount;

    address public governanceAccount;
    address public lfiAddress;
    address public underlyingAssetAddress;
    address public ltokenAddress;
    address public dsecDistributionAddress;

    uint256 public totalUnderlyingAssetAmount;
    uint256 public totalLtokenAmount;

    address[] private _farmingPoolAddresses;

    function initialize(
        address lfiAddress_,
        address underlyingAssetAddress_,
        address ltokenAddress_,
        address dsecDistributionAddress_,
        uint256 lpRewardPerEpoch_,
        uint256 teamRewardPerEpoch_,
        address teamAccount_
    ) external initializer {
        __Pausable_init_unchained();
        __ReentrancyGuard_init_unchained();

        require(
            lfiAddress_ != address(0),
            "UniswapV3TreasuryPool: zero LFI address"
        );
        require(
            underlyingAssetAddress_ != address(0),
            "UniswapV3TreasuryPool: zero underlying asset address"
        );
        require(
            ltokenAddress_ != address(0),
            "UniswapV3TreasuryPool: zero LToken address"
        );
        require(
            dsecDistributionAddress_ != address(0),
            "UniswapV3TreasuryPool: zero dsec distribution address"
        );
        require(
            teamAccount_ != address(0),
            "UniswapV3TreasuryPool: zero team account"
        );

        governanceAccount = msg.sender;
        lfiAddress = lfiAddress_;
        underlyingAssetAddress = underlyingAssetAddress_;
        ltokenAddress = ltokenAddress_;
        dsecDistributionAddress = dsecDistributionAddress_;
        lpRewardPerEpoch = lpRewardPerEpoch_;
        teamRewardPerEpoch = teamRewardPerEpoch_;
        teamAccount = teamAccount_;
    }

    modifier onlyBy(address account) {
        require(
            msg.sender == account,
            "UniswapV3TreasuryPool: sender not authorized"
        );
        _;
    }

    modifier onlyFarmingPool() {
        require(
            _farmingPoolAddresses.contains(msg.sender),
            "UniswapV3TreasuryPool: sender not a farming pool"
        );
        _;
    }

    function farmingPoolAddresses() external view returns (address[] memory) {
        return _farmingPoolAddresses;
    }

    function addLiquidity(uint256 tokenId) external override nonReentrant {
        require(!paused(), "UniswapV3TreasuryPool: deposit while paused");

        (, , , , , , , uint128 amount, , , , ) =
            INonfungiblePositionManager(underlyingAssetAddress).positions(
                tokenId
            );

        uint256 ltokenAmount = amount;

        totalUnderlyingAssetAmount = totalUnderlyingAssetAmount.add(amount);
        totalLtokenAmount = totalLtokenAmount.add(ltokenAmount);

        // https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-3
        // slither-disable-next-line reentrancy-events
        emit AddLiquidity(
            msg.sender,
            underlyingAssetAddress,
            ltokenAddress,
            tokenId,
            ltokenAmount,
            block.timestamp
        );

        INonfungiblePositionManager(underlyingAssetAddress).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );
        IDsecDistribution(dsecDistributionAddress).addDsec(msg.sender, amount);
        ILtoken(ltokenAddress).mint(msg.sender, tokenId);
        ILtoken(ltokenAddress).setTokenAmount(tokenId, ltokenAmount);
    }

    function removeLiquidity(uint256 tokenId) external override nonReentrant {
        uint256 totalUnderlyingAssetAvailable =
            getTotalUnderlyingAssetAvailableCore();

        require(!paused(), "UniswapV3TreasuryPool: withdraw while paused");
        require(
            totalUnderlyingAssetAvailable > 0,
            "UniswapV3TreasuryPool: insufficient liquidity"
        );

        ILtoken ltoken = ILtoken(ltokenAddress);
        uint256 amount = ltoken.getTokenAmount(tokenId);
        require(
            ltoken.balanceOf(msg.sender) >= amount,
            "UniswapV3TreasuryPool: insufficient LToken"
        );

        uint256 underlyingAssetAmount = amount;
        require(
            totalUnderlyingAssetAvailable >= underlyingAssetAmount,
            "UniswapV3TreasuryPool: insufficient liquidity"
        );

        totalUnderlyingAssetAmount = totalUnderlyingAssetAmount.sub(
            underlyingAssetAmount
        );
        totalLtokenAmount = totalLtokenAmount.sub(amount);

        // https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-3
        // slither-disable-next-line reentrancy-events
        emit RemoveLiquidity(
            msg.sender,
            ltokenAddress,
            underlyingAssetAddress,
            tokenId,
            underlyingAssetAmount,
            block.timestamp
        );

        ltoken.burn(msg.sender, tokenId);
        IDsecDistribution(dsecDistributionAddress).removeDsec(
            msg.sender,
            underlyingAssetAmount
        );
        INonfungiblePositionManager(underlyingAssetAddress).safeTransferFrom(
            address(this),
            msg.sender,
            tokenId
        );
    }

    function redeemProviderReward(uint256 fromEpoch, uint256 toEpoch)
        external
        override
    {
        require(
            fromEpoch <= toEpoch,
            "UniswapV3TreasuryPool: invalid epoch range"
        );
        require(!paused(), "UniswapV3TreasuryPool: redeem while paused");

        uint256 totalRewardAmount = 0;
        IDsecDistribution dsecDistribution =
            IDsecDistribution(dsecDistributionAddress);
        for (uint256 i = fromEpoch; i <= toEpoch; i++) {
            // https://github.com/crytic/slither/wiki/Detector-Documentation#calls-inside-a-loop
            // slither-disable-next-line calls-loop
            if (dsecDistribution.hasRedeemedDsec(msg.sender, i)) {
                break;
            }

            // https://github.com/crytic/slither/wiki/Detector-Documentation#calls-inside-a-loop
            // slither-disable-next-line calls-loop
            uint256 rewardAmount =
                dsecDistribution.redeemDsec(msg.sender, i, lpRewardPerEpoch);
            totalRewardAmount = totalRewardAmount.add(rewardAmount);
        }

        if (totalRewardAmount == 0) {
            return;
        }

        emit RedeemProviderReward(
            msg.sender,
            fromEpoch,
            toEpoch,
            lfiAddress,
            totalRewardAmount,
            block.timestamp
        );

        ILfi(lfiAddress).redeem(msg.sender, totalRewardAmount);
    }

    function redeemTeamReward(uint256 fromEpoch, uint256 toEpoch)
        external
        override
        onlyBy(teamAccount)
    {
        require(
            fromEpoch <= toEpoch,
            "UniswapV3TreasuryPool: invalid epoch range"
        );
        require(!paused(), "UniswapV3TreasuryPool: redeem while paused");

        uint256 totalRewardAmount = 0;
        IDsecDistribution dsecDistribution =
            IDsecDistribution(dsecDistributionAddress);
        for (uint256 i = fromEpoch; i <= toEpoch; i++) {
            // https://github.com/crytic/slither/wiki/Detector-Documentation#calls-inside-a-loop
            // slither-disable-next-line calls-loop
            if (dsecDistribution.hasRedeemedTeamReward(i)) {
                break;
            }

            // https://github.com/crytic/slither/wiki/Detector-Documentation#calls-inside-a-loop
            // slither-disable-next-line calls-loop
            dsecDistribution.redeemTeamReward(i);
            totalRewardAmount = totalRewardAmount.add(teamRewardPerEpoch);
        }

        if (totalRewardAmount == 0) {
            return;
        }

        emit RedeemTeamReward(
            teamAccount,
            fromEpoch,
            toEpoch,
            lfiAddress,
            totalRewardAmount,
            block.timestamp
        );

        ILfi(lfiAddress).redeem(teamAccount, totalRewardAmount);
    }

    function loan(
        uint256 /* amount */
    ) external override onlyFarmingPool() {
        revert("UniswapV3TreasuryPool: not supported");
    }

    function repay(
        uint256, /* principal */
        uint256 /* interest */
    ) external override onlyFarmingPool() {
        revert("UniswapV3TreasuryPool: not supported");
    }

    function estimateUnderlyingAssetsFor(uint256 amount)
        external
        pure
        override
        returns (uint256)
    {
        return amount;
    }

    function estimateLtokensFor(uint256 amount)
        external
        pure
        override
        returns (uint256)
    {
        return amount;
    }

    function getUtilisationRate() external pure override returns (uint256) {
        return 0;
    }

    function getTotalUnderlyingAssetAvailableCore()
        internal
        view
        returns (uint256)
    {
        return totalUnderlyingAssetAmount;
    }

    function getTotalUnderlyingAssetAvailable()
        external
        view
        override
        returns (uint256)
    {
        return getTotalUnderlyingAssetAvailableCore();
    }

    function setGovernanceAccount(address newGovernanceAccount)
        external
        onlyBy(governanceAccount)
    {
        require(
            newGovernanceAccount != address(0),
            "UniswapV3TreasuryPool: zero new governance account"
        );

        governanceAccount = newGovernanceAccount;
    }

    function pause() external onlyBy(governanceAccount) {
        _pause();
    }

    function unpause() external onlyBy(governanceAccount) {
        _unpause();
    }
}

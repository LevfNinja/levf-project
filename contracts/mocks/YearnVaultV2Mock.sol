// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../libraries/Exponential.sol";
import "../interfaces/external/yearn/IVault.sol";
import "./UnderlyingAssetMock.sol";

contract YearnVaultV2Mock is IVault {
    using SafeMath for uint256;
    using Exponential for uint256;

    uint256 public constant NOMINAL_ANNUAL_RATE = 15;
    uint256 public constant NUM_FRACTION_BITS = 64;
    uint256 public constant SECONDS_IN_DAY = 86400;
    uint256 public constant DAYS_IN_YEAR = 365;
    uint256 public constant SECONDS_IN_YEAR = SECONDS_IN_DAY * DAYS_IN_YEAR;
    uint256 public constant PERCENT_100 = 100;

    mapping(address => uint256) private _balances;

    uint256 public override decimals;
    uint256 public totalSupply;

    UnderlyingAssetMock public token;

    uint256 public lastReport; // block.timestamp of last report

    bool public testTransferFail = false;

    constructor(address token_) {
        decimals = 18;
        token = UnderlyingAssetMock(token_);
    }

    function pricePerShare() external view override returns (uint256) {
        return _shareValue(10**decimals);
    }

    function deposit(uint256 amount, address recipient)
        external
        override
        returns (uint256)
    {
        require(amount > 0, "0 amount");

        // Issue new shares (needs to be done before taking deposit to be accurate)
        // Shares are issued to recipient (may be different from msg.sender)
        uint256 shares = _issueSharesForAmount(recipient, amount);

        if (lastReport == 0) {
            lastReport = block.timestamp;
        }

        // Tokens are transferred from msg.sender (may be different from _recipient)
        // https://github.com/crytic/slither/wiki/Detector-Documentation#unused-return
        // https://github.com/crytic/slither/wiki/Detector-Documentation#unchecked-transfer
        // slither-disable-next-line unused-return,unchecked-transfer
        token.transferFrom(msg.sender, address(this), amount);

        return shares;
    }

    function withdraw(
        uint256 maxShares,
        address recipient,
        uint256
    ) external override returns (uint256) {
        uint256 shares = maxShares; // May reduce this number below

        // Limit to only the shares they own
        require(shares <= _balances[msg.sender], "exceed shares owned");

        // Ensure we are withdrawing something
        require(shares > 0, "0 shares");

        // https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-1
        // https://github.com/crytic/slither/wiki/Detector-Documentation#reentrancy-vulnerabilities-2
        // slither-disable-next-line reentrancy-no-eth,reentrancy-benign
        harvest();

        uint256 value = _shareValue(shares);

        // Burn shares (full value of what is being withdrawn)
        totalSupply -= shares;
        _balances[msg.sender] -= shares;

        // Withdraw remaining balance to _recipient (may be different to msg.sender) (minus fee)
        // https://github.com/crytic/slither/wiki/Detector-Documentation#unused-return
        // https://github.com/crytic/slither/wiki/Detector-Documentation#unchecked-transfer
        // slither-disable-next-line unused-return,unchecked-transfer
        token.transfer(recipient, value);

        return value;
    }

    function balanceOf(address account)
        external
        view
        override
        returns (uint256)
    {
        return _balances[account];
    }

    function transfer(address receiver, uint256 amount)
        external
        override
        returns (bool)
    {
        require(receiver != address(0), "0 receiver");
        require(receiver != address(this), "self receiver");

        _balances[msg.sender] -= amount;
        _balances[receiver] += amount;
        return !testTransferFail;
    }

    /**
     * @dev Returns the accrue per second compound interest, reverts if overflow
     *
     * @param presentValue in wei
     * @param nominalAnnualRate as percentage in unsigned integer
     * @param numSeconds in unsigned integer
     * @return futureValue in wei
     */
    function accruePerSecondCompoundInterest(
        uint256 presentValue,
        uint256 nominalAnnualRate,
        uint256 numSeconds
    ) public pure returns (uint256 futureValue) {
        require(nominalAnnualRate <= 100, "> 100%");

        uint256 exponent =
            numSeconds.mul(
                (
                    ((
                        nominalAnnualRate.add(SECONDS_IN_YEAR.mul(PERCENT_100))
                    ) << NUM_FRACTION_BITS)
                        .div(SECONDS_IN_YEAR.mul(PERCENT_100))
                )
                    .logBase2()
            );

        futureValue =
            exponent.expBase2().mul(presentValue) >>
            NUM_FRACTION_BITS;
    }

    function testUpdateDecimals(uint256 newDecimals) external {
        decimals = newDecimals;
    }

    function testSetTransferFail(bool value) external {
        testTransferFail = value;
    }

    function _totalAssets() internal view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function harvest() public {
        uint256 totalAssets = _totalAssets();
        uint256 futureValue =
            accruePerSecondCompoundInterest(
                totalAssets,
                NOMINAL_ANNUAL_RATE,
                block.timestamp.sub(lastReport)
            );
        uint256 interestEarned = futureValue.sub(totalAssets);
        lastReport = block.timestamp;
        token.mint(address(this), interestEarned);
    }

    function _issueSharesForAmount(address to, uint256 amount)
        internal
        returns (uint256)
    {
        // Issues `amount` Vault shares to `to`.
        // Shares must be issued prior to taking on new collateral, or
        // calculation will be wrong. This means that only *trusted* tokens
        // (with no capability for exploitative behavior) can be used.
        uint256 shares = 0;
        if (totalSupply > 0) {
            // Mint amount of shares based on what the Vault is managing overall
            // NOTE: if sqrt(token.totalSupply()) > 1e39, this could potentially revert
            shares = (amount * totalSupply) / _totalAssets();
        } else {
            // No existing shares, so mint 1:1
            shares = amount;
        }

        // Mint new shares
        totalSupply += shares;
        _balances[to] += shares;

        return shares;
    }

    function _shareValue(uint256 shares) internal view returns (uint256) {
        // Returns price = 1:1 if vault is empty
        // https://github.com/crytic/slither/wiki/Detector-Documentation#dangerous-strict-equalities
        // slither-disable-next-line incorrect-equality
        if (totalSupply == 0) {
            return shares;
        }

        return (shares * _totalAssets()) / totalSupply;
    }
}

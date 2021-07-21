const assert = require("assert");
const { expectEvent, expectRevert, time } = require("@openzeppelin/test-helpers");
const timeMachine = require("ganache-time-traveler");
const { BN, ether, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

const NUM_SECONDS_IN_DAY = 86400;
const NUM_DAYS_IN_YEAR = 365;
const NUM_SECONDS_IN_YEAR = NUM_SECONDS_IN_DAY * NUM_DAYS_IN_YEAR;
const BN_ZERO = new BN("0");
const BN_ONE = new BN("1");
const BN_POINT_ZERO_SQUARE_FIVE = ether("0.005");
const BN_POINT_ZERO_CUBE_FIVE = ether("0.0005");
const BN_POINT_ZERO_QUAD_FIVE = ether("0.00005");
const BN_POINT_ZERO_PENTA_FIVE = ether("0.000005");
const BN_POINT_ZERO_HEXA_FIVE = ether("0.0000005");

describe("FarmingPool", () => {
  const LEVERAGE_FACTOR = 20;
  const LIQUIDATION_PENALTY = new BN("10");
  const TAX_RATE = new BN("10");
  const PERCENT_100 = new BN("100");

  let accounts;
  let defaultGovernanceAccount;
  let snapshotId;

  let dsecDistribution;
  let lfi;
  let ltoken;
  let treasuryPool;
  let insuranceFundAddress;
  let underlyingAsset;
  let yearnVaultV2;
  let yvdaiAdapter;

  let farmingPool;

  async function addLiquidityInFarmingPool(amount, account) {
    await underlyingAsset.mint(account, amount, { from: defaultGovernanceAccount });
    await underlyingAsset.approve(farmingPool.address, amount, { from: account });
    return await farmingPool.addLiquidity(amount, { from: account });
  }

  async function addLiquidityInTreasuryPool(amount, account) {
    await underlyingAsset.mint(account, amount, { from: defaultGovernanceAccount });
    await underlyingAsset.approve(treasuryPool.address, amount, { from: account });
    return await treasuryPool.addLiquidity(amount, { from: account });
  }

  function calculateInterestFactor(interestRate, durationInSeconds) {
    // interestRate: number as float, durationInSeconds: number as unsigned integer
    return ((100.0 * NUM_SECONDS_IN_YEAR + interestRate) / (100.0 * NUM_SECONDS_IN_YEAR)) ** durationInSeconds;
  }

  function accrueInterestForLoans(loans, currentTimestamp) {
    // [0]: interestRates
    // [1]: principalsOnly
    // [2]: principalsWithInterest
    // [3]: lastAccrualTimestamps
    let outstandingInterest = new BN("0");
    for (let i = 0; i < loans[0].length; i++) {
      console.log(
        `${i} before: interestRate=${loans[0][i]}, principalOnly=${loans[1][i]}, principalWithInterest=${loans[2][i]}, lastAccrualTimestamp=${loans[3][i]}`
      );
      const secondsSinceLastAccrual = currentTimestamp.sub(loans[3][i]);
      console.log(
        `${i}: secondsSinceLastAccrual=${secondsSinceLastAccrual.toNumber()}, loans[0]=${parseFloat(
          web3.utils.fromWei(loans[2][i], "ether")
        )}, loans[2]=${loans[0][i].toNumber()}, (1 + r)=${calculateInterestFactor(
          loans[0][i].toNumber(),
          1
        )}, (1 + r)^t=${calculateInterestFactor(loans[0][i].toNumber(), secondsSinceLastAccrual.toNumber())}`
      );
      const principalWithInterest =
        parseFloat(web3.utils.fromWei(loans[2][i], "ether")) *
        calculateInterestFactor(loans[0][i].toNumber(), secondsSinceLastAccrual.toNumber());
      loans[2][i] = ether(principalWithInterest.toString());
      loans[3][i] = currentTimestamp;
      console.log(
        `${i} after: secondsSinceLastAccrual=${secondsSinceLastAccrual}, interestRate=${loans[0][i]}, principalOnly=${loans[1][i]}, principalWithInterest=${loans[2][i]}, lastAccrualTimestamp=${loans[3][i]}`
      );
      outstandingInterest = outstandingInterest.add(loans[2][i]).sub(loans[1][i]);
    }

    return outstandingInterest;
  }

  function calculateRepaymentDetails(
    taxRate,
    btokenAmount,
    underlyingAssetQuantity,
    totalTransferToAdapter,
    btokenBalance,
    outstandingInterest
  ) {
    const underlyingAssetInvested = btokenAmount.mul(totalTransferToAdapter).div(btokenBalance);

    let profit = new BN("0");
    let taxAmount = new BN("0");
    if (underlyingAssetQuantity.gt(underlyingAssetInvested)) {
      profit = underlyingAssetQuantity.sub(underlyingAssetInvested);
      taxAmount = profit.mul(taxRate).div(PERCENT_100);
    }
    const principal = underlyingAssetInvested.div(new BN(LEVERAGE_FACTOR.toString()));
    const payableInterest = outstandingInterest.mul(underlyingAssetInvested).div(totalTransferToAdapter);
    const loanPrincipalToRepay = underlyingAssetInvested
      .mul(new BN(LEVERAGE_FACTOR - 1))
      .div(new BN(LEVERAGE_FACTOR.toString()));
    let amountToReceive = 0.0;
    if (underlyingAssetQuantity.gt(underlyingAssetInvested)) {
      console.log(
        `underlyingAssetQuantity > underlyingAssetInvested: ${underlyingAssetQuantity} > ${underlyingAssetInvested}`
      );
      if (principal.add(profit).lt(taxAmount.add(payableInterest))) {
        console.log(
          `principalWithProfit < taxWithPayableInterest: loanPrincipalToRepay=${loanPrincipalToRepay}, principal=${principal}, profit=${profit}, taxAmount=${taxAmount}, payableInterest=${payableInterest}`
        );
        amountToReceive = underlyingAssetQuantity.sub(loanPrincipalToRepay).sub(taxAmount).sub(payableInterest);
      } else {
        console.log(
          `principalWithProfit >= taxWithPayableInterest: principal=${principal}, profit=${profit}, taxAmount=${taxAmount}, payableInterest=${payableInterest}`
        );
        amountToReceive = principal.add(profit).sub(taxAmount).sub(payableInterest);
      }
    } else {
      console.log(
        `underlyingAssetQuantity <= underlyingAssetInvested: underlyingAssetQuantity=${underlyingAssetQuantity}, underlyingAssetInvested=${underlyingAssetInvested}, loanPrincipalToRepay=${loanPrincipalToRepay}, payableInterest=${payableInterest}`
      );
      amountToReceive = underlyingAssetQuantity.sub(loanPrincipalToRepay).sub(payableInterest);
    }
    console.log(
      `btokenAmount=${btokenAmount}, underlyingAssetQuantity=${underlyingAssetQuantity}, totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}, underlyingAssetInvested=${underlyingAssetInvested}, profit=${profit}, taxAmount=${taxAmount}, principal=${principal}, payableInterest=${payableInterest}, loanPrincipalToRepay=${loanPrincipalToRepay}, amountToReceive=${amountToReceive}`
    );

    return {
      underlyingAssetInvested: underlyingAssetInvested,
      profit: profit,
      taxAmount: taxAmount,
      depositPrincipal: principal,
      payableInterest: payableInterest,
      loanPrincipalToRepay: loanPrincipalToRepay,
      amountToReceive: amountToReceive,
    };
  }

  function repayPrincipalWithInterest(
    farmerPrincipalsWithInterest,
    poolPrincipalsWithInterest,
    loanPrincipalToRepay,
    payableInterest
  ) {
    let principalsWithInterestForFarmer = [];
    let principalsWithInterestForPool = [];
    let repayPrincipalWithInterestRemaining = loanPrincipalToRepay.add(payableInterest);
    for (let i = farmerPrincipalsWithInterest.length - 1; i >= 0; i--) {
      if (repayPrincipalWithInterestRemaining.gt(BN_ZERO) > 0) {
        if (farmerPrincipalsWithInterest[i].gt(repayPrincipalWithInterestRemaining)) {
          console.log(
            `repayPrincipalWithInterest ${i} (>)(>): repayPrincipalWithInterestRemaining=${repayPrincipalWithInterestRemaining}, farmerPrincipalsWithInterest=${farmerPrincipalsWithInterest[i]}, poolPrincipalsWithInterest=${poolPrincipalsWithInterest[i]}`
          );
          principalsWithInterestForFarmer.unshift(
            farmerPrincipalsWithInterest[i].sub(repayPrincipalWithInterestRemaining)
          );
          principalsWithInterestForPool.unshift(poolPrincipalsWithInterest[i].sub(repayPrincipalWithInterestRemaining));
          repayPrincipalWithInterestRemaining = new BN("0");
        } else {
          console.log(
            `repayPrincipalWithInterest ${i} (>)(<=): repayPrincipalWithInterestRemaining=${repayPrincipalWithInterestRemaining}, farmerPrincipalsWithInterest=${farmerPrincipalsWithInterest[i]}, poolPrincipalsWithInterest=${poolPrincipalsWithInterest[i]}`
          );
          if (!poolPrincipalsWithInterest[i].eq(farmerPrincipalsWithInterest[i])) {
            console.log(
              `repayPrincipalWithInterest ${i} (>)(<=)(!=): ${poolPrincipalsWithInterest[i].sub(
                farmerPrincipalsWithInterest[i]
              )}`
            );
            principalsWithInterestForPool.unshift(poolPrincipalsWithInterest[i].sub(farmerPrincipalsWithInterest[i]));
          }

          repayPrincipalWithInterestRemaining = repayPrincipalWithInterestRemaining.sub(
            farmerPrincipalsWithInterest[i]
          );
        }
      } else {
        console.log(
          `repayPrincipalWithInterest ${i} (<=): repayPrincipalWithInterestRemaining=${repayPrincipalWithInterestRemaining}, farmerPrincipalsWithInterest=${farmerPrincipalsWithInterest[i]}, poolPrincipalsWithInterest=${poolPrincipalsWithInterest[i]}`
        );
        principalsWithInterestForFarmer.unshift(farmerPrincipalsWithInterest[i]);
        principalsWithInterestForPool.unshift(poolPrincipalsWithInterest[i]);
      }
    }

    return {
      principalsWithInterestForFarmer: principalsWithInterestForFarmer,
      principalsWithInterestForPool: principalsWithInterestForPool,
    };
  }

  before(async () => {
    accounts = await web3.eth.getAccounts();
    defaultGovernanceAccount = accounts[0];
    defaultLpAccount = accounts[1];

    const snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot["result"];
  });

  after(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  beforeEach(async () => {
    const latestBlockTimestamp = await time.latest();
    const epoch0StartTimestamp = latestBlockTimestamp.add(time.duration.days(1));

    lfi = await testUtil.newLfi();
    underlyingAsset = await testUtil.newUnderlyingAssetMock();
    ltoken = await testUtil.newErc20Ltoken();
    dsecDistribution = await testUtil.newDsecDistribution(epoch0StartTimestamp);
    treasuryPool = await testUtil.newTreasuryPool(
      lfi.address,
      underlyingAsset.address,
      ltoken.address,
      dsecDistribution.address
    );

    insuranceFundAddress = accounts[2];

    btoken = await testUtil.newBtoken();
    farmingPool = await testUtil.newFarmingPool(
      "Yearn DAI Vault",
      underlyingAsset.address,
      btoken.address,
      treasuryPool.address,
      insuranceFundAddress
    );

    yearnVaultV2 = await testUtil.newYearnVaultV2Mock(underlyingAsset.address);
    yvdaiAdapter = await testUtil.newYvdaiAdapter(underlyingAsset.address, yearnVaultV2.address, farmingPool.address);

    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await treasuryPool.addFarmingPoolAddress(farmingPool.address, { from: defaultGovernanceAccount });
    await btoken.setFarmingPoolAddress(farmingPool.address, { from: defaultGovernanceAccount });
    await farmingPool.setAdapterAddress(yvdaiAdapter.address);
    await addLiquidityInTreasuryPool(ether("1000000"), defaultLpAccount);
  });

  it("should be initialized correctly", async () => {
    const name = await farmingPool.name();
    const governanceAccount = await farmingPool.governanceAccount();
    const underlyingAssetAddress = await farmingPool.underlyingAssetAddress();
    const btokenAddress = await farmingPool.btokenAddress();
    const treasuryPoolAddress = await farmingPool.treasuryPoolAddress();
    const insuranceFundAddress = await farmingPool.insuranceFundAddress();
    const leverageFactor = await farmingPool.leverageFactor();
    const liquidationPenalty = await farmingPool.liquidationPenalty();
    const taxRate = await farmingPool.taxRate();
    const borrowerInterestRateModel = await farmingPool.borrowerInterestRateModel();

    const expectName = "Yearn DAI Vault";
    const expectGovernanceAccount = defaultGovernanceAccount;
    const expectUnderlyingAssetAddress = underlyingAsset.address;
    const expectBtokenAddress = btoken.address;
    const expectTreasuryPoolAddress = treasuryPool.address;
    const expectInsuranceFundAddress = accounts[2];
    const expectLeverageFactor = new BN("20");
    const expectLiquidationPenalty = new BN("10");
    const expectTaxRate = new BN("10");
    const expectBorrowerInterestRateModel = {
      interestRateIntegerPoint1: "10", // as percentage in unsigned integer
      interestRateIntegerPoint2: "25", // as percentage in unsigned integer
      utilisationRatePoint1: new BN("320000000000000000", 16), // 50% in unsigned 64.64 fixed-point number
      utilisationRatePoint2: new BN("5F0000000000000000", 16), // 95% in unsigned 64.64 fixed-point number
      interestRateSlope1: new BN("5555555555555555", 16), // 1/3 in unsigned 64.64 fixed-point number
      interestRateSlope2: new BN("F0000000000000000", 16), // 15 in unsigned 64.64 fixed-point number
    };

    assert.strictEqual(name, expectName, `Name is ${name} instead of ${expectName}`);
    assert.strictEqual(
      governanceAccount,
      expectGovernanceAccount,
      `Governance account is ${governanceAccount} instead of creator ${expectGovernanceAccount}`
    );
    assert.strictEqual(
      underlyingAssetAddress,
      expectUnderlyingAssetAddress,
      `Underlying asset address is ${underlyingAssetAddress} instead of ${expectUnderlyingAssetAddress}`
    );
    assert.strictEqual(
      btokenAddress,
      expectBtokenAddress,
      `BToken address is ${btokenAddress} instead of ${expectBtokenAddress}`
    );
    assert.strictEqual(
      treasuryPoolAddress,
      expectTreasuryPoolAddress,
      `Treasury pool aAddress is ${treasuryPoolAddress} instead of ${expectTreasuryPoolAddress}`
    );
    assert.strictEqual(
      insuranceFundAddress,
      expectInsuranceFundAddress,
      `Insurance fund aAddress is ${insuranceFundAddress} instead of ${expectInsuranceFundAddress}`
    );
    assert.ok(
      leverageFactor.eq(expectLeverageFactor),
      `Leverage factor is ${leverageFactor} instead of ${expectLeverageFactor}`
    );
    assert.ok(
      liquidationPenalty.eq(expectLiquidationPenalty),
      `Liquidation penalty is ${liquidationPenalty} instead of ${expectLiquidationPenalty}`
    );
    assert.ok(taxRate.eq(expectTaxRate), `Tax rate is ${taxRate} instead of ${expectTaxRate}`);
    assert.strictEqual(
      borrowerInterestRateModel[0],
      expectBorrowerInterestRateModel.interestRateIntegerPoint1,
      `Interest rate integer point 1 is ${borrowerInterestRateModel[0]} instead of ${expectBorrowerInterestRateModel.interestRateIntegerPoint1}`
    );
    assert.strictEqual(
      borrowerInterestRateModel[1],
      expectBorrowerInterestRateModel.interestRateIntegerPoint2,
      `Interest rate integer point 2 is ${borrowerInterestRateModel[1]} instead of ${expectBorrowerInterestRateModel.interestRateIntegerPoint2}`
    );
    assert.ok(
      new BN(borrowerInterestRateModel[2]).eq(expectBorrowerInterestRateModel.utilisationRatePoint1),
      `Utilisation rate point 1 is ${borrowerInterestRateModel[2]} instead of ${expectBorrowerInterestRateModel.utilisationRatePoint1}`
    );
    assert.ok(
      new BN(borrowerInterestRateModel[3]).eq(expectBorrowerInterestRateModel.utilisationRatePoint2),
      `Utilisation rate point 2 is ${borrowerInterestRateModel[3]} instead of ${expectBorrowerInterestRateModel.utilisationRatePoint2}`
    );
    assert.ok(
      new BN(borrowerInterestRateModel[4]).eq(expectBorrowerInterestRateModel.interestRateSlope1),
      `Interest rate slope 1 is ${borrowerInterestRateModel[4]} instead of ${expectBorrowerInterestRateModel.interestRateSlope1}`
    );
    assert.ok(
      new BN(borrowerInterestRateModel[5]).eq(expectBorrowerInterestRateModel.interestRateSlope2),
      `Interest rate slope 2 is ${borrowerInterestRateModel[5]} instead of ${expectBorrowerInterestRateModel.interestRateSlope2}`
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        ZERO_ADDRESS,
        btoken.address,
        treasuryPool.address,
        expectInsuranceFundAddress,
        expectLeverageFactor,
        expectLiquidationPenalty,
        expectTaxRate
      ),
      "0 underlying asset address"
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        underlyingAsset.address,
        ZERO_ADDRESS,
        treasuryPool.address,
        expectInsuranceFundAddress,
        expectLeverageFactor,
        expectLiquidationPenalty,
        expectTaxRate
      ),
      "0 BToken address"
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        underlyingAsset.address,
        btoken.address,
        ZERO_ADDRESS,
        expectInsuranceFundAddress,
        expectLeverageFactor,
        expectLiquidationPenalty,
        expectTaxRate
      ),
      "0 treasury pool address"
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        underlyingAsset.address,
        btoken.address,
        treasuryPool.address,
        ZERO_ADDRESS,
        expectLeverageFactor,
        expectLiquidationPenalty,
        expectTaxRate
      ),
      "0 insurance fund address"
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        underlyingAsset.address,
        btoken.address,
        treasuryPool.address,
        expectInsuranceFundAddress,
        BN_ZERO,
        expectLiquidationPenalty,
        expectTaxRate
      ),
      "leverage factor < 1"
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        underlyingAsset.address,
        btoken.address,
        treasuryPool.address,
        expectInsuranceFundAddress,
        expectLeverageFactor,
        new BN("101"),
        expectTaxRate
      ),
      "liquidation penalty > 100%"
    );

    await expectRevert(
      testUtil.newFarmingPool(
        expectName,
        underlyingAsset.address,
        btoken.address,
        treasuryPool.address,
        expectInsuranceFundAddress,
        expectLeverageFactor,
        expectLiquidationPenalty,
        new BN("101")
      ),
      "tax rate > 100%"
    );
  });

  it("should only allow governance account to change governance account", async () => {
    const nonGovernanceAccount = accounts[8];
    const expectNewGovernanceAccount = accounts[9];

    await expectRevert(
      farmingPool.setGovernanceAccount(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "0 governance account"
    );

    await expectRevert(
      farmingPool.setGovernanceAccount(expectNewGovernanceAccount, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await farmingPool.governanceAccount();
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );

    await expectRevert(
      farmingPool.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setGovernanceAccount(defaultGovernanceAccount, { from: expectNewGovernanceAccount });
    const governanceAccount = await farmingPool.governanceAccount();
    assert.strictEqual(
      governanceAccount,
      defaultGovernanceAccount,
      `Governance account is ${governanceAccount} instead of ${defaultGovernanceAccount}`
    );
  });

  it("should only allow governance account to change treasury pool address", async () => {
    const defaultTreasuryPoolAddress = await farmingPool.treasuryPoolAddress();
    const nonGovernanceAccount = accounts[8];
    const expectNewTreasuryPoolAddress = accounts[9];

    await expectRevert(
      farmingPool.setTreasuryPoolAddress(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "0 treasury pool address"
    );

    await expectRevert(
      farmingPool.setTreasuryPoolAddress(expectNewTreasuryPoolAddress, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setTreasuryPoolAddress(expectNewTreasuryPoolAddress, { from: defaultGovernanceAccount });
    const newTreasuryPoolAddress = await farmingPool.treasuryPoolAddress();
    assert.strictEqual(
      newTreasuryPoolAddress,
      expectNewTreasuryPoolAddress,
      `New treasury pool address is ${newTreasuryPoolAddress} instead of ${expectNewTreasuryPoolAddress}`
    );

    await expectRevert(
      farmingPool.setTreasuryPoolAddress(defaultTreasuryPoolAddress, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setTreasuryPoolAddress(defaultTreasuryPoolAddress, { from: defaultGovernanceAccount });
    const treasuryPoolAddress = await farmingPool.treasuryPoolAddress();
    assert.strictEqual(
      treasuryPoolAddress,
      defaultTreasuryPoolAddress,
      `Treasury pool address is ${treasuryPoolAddress} instead of ${defaultTreasuryPoolAddress}`
    );
  });

  it("should only allow governance account to change adapter address", async () => {
    const defaultAdapterAddress = accounts[7];
    const nonGovernanceAccount = accounts[8];
    const expectNewAdapterAddress = accounts[9];

    await expectRevert(
      farmingPool.setAdapterAddress(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "0 adapter address"
    );

    await expectRevert(
      farmingPool.setAdapterAddress(expectNewAdapterAddress, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setAdapterAddress(expectNewAdapterAddress, { from: defaultGovernanceAccount });
    const newAdapterAddress = await farmingPool.adapterAddress();
    assert.strictEqual(
      newAdapterAddress,
      expectNewAdapterAddress,
      `New adapter address is ${newAdapterAddress} instead of ${expectNewAdapterAddress}`
    );

    await expectRevert(
      farmingPool.setAdapterAddress(defaultAdapterAddress, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setAdapterAddress(defaultAdapterAddress, { from: defaultGovernanceAccount });
    const adapterAddress = await farmingPool.adapterAddress();
    assert.strictEqual(
      adapterAddress,
      defaultAdapterAddress,
      `Adapter address is ${adapterAddress} instead of ${defaultAdapterAddress}`
    );
  });

  it("should not allow calculate borrower interest rate model for 0 interest rates", async () => {
    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ZERO, BN_ONE, BN_ONE, BN_ONE),
      "0 point 1 interest rate"
    );

    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ONE, BN_ZERO, BN_ONE, BN_ONE),
      "0 point 2 interest rate"
    );
  });

  it("should not allow calculate borrower interest rate model for interest rates >= 100%", async () => {
    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(PERCENT_100, BN_ONE, BN_ONE, BN_ONE),
      "point 1 interest rate equal or exceed 100%"
    );

    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ONE, PERCENT_100, BN_ONE, BN_ONE),
      "point 2 interest rate equal or exceed 100%"
    );
  });

  it("should not allow calculate borrower interest rate model for 0 utilisation rates", async () => {
    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ONE, BN_ONE, BN_ZERO, BN_ONE),
      "0 point 1 utilisation rate"
    );

    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ONE, BN_ONE, BN_ONE, BN_ZERO),
      "0 point 2 utilisation rate"
    );
  });

  it("should not allow calculate borrower interest rate model for utilisation rates >= 100%", async () => {
    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ONE, BN_ONE, PERCENT_100, BN_ONE),
      "point 1 utilisation rate equal or exceed 100%"
    );

    await expectRevert(
      farmingPool.calculateBorrowerInterestRateModel(BN_ONE, BN_ONE, BN_ONE, PERCENT_100),
      "point 2 utilisation rate equal or exceed 100%"
    );
  });

  it("should only allow governance account to change liquidation penalty", async () => {
    const nonGovernanceAccount = accounts[8];
    const expectDefaultLiquidationPenalty = new BN("10");
    const expectNewLiquidationPenalty = new BN("20");
    const expectZeroLiquidationPenalty = new BN("0");

    await expectRevert(
      farmingPool.setLiquidationPenalty(expectNewLiquidationPenalty, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setLiquidationPenalty(expectNewLiquidationPenalty, { from: defaultGovernanceAccount });
    const newLiquidationPenalty = await farmingPool.liquidationPenalty();
    assert.ok(
      newLiquidationPenalty.eq(expectNewLiquidationPenalty),
      `New liquidation penalty is ${newLiquidationPenalty} instead of ${expectNewLiquidationPenalty}`
    );

    await expectRevert(
      farmingPool.setLiquidationPenalty(expectDefaultLiquidationPenalty, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setLiquidationPenalty(expectDefaultLiquidationPenalty, { from: defaultGovernanceAccount });
    const defaultLiquidationPenalty = await farmingPool.liquidationPenalty();
    assert.ok(
      defaultLiquidationPenalty.eq(expectDefaultLiquidationPenalty),
      `Default liquidation penalty is ${defaultLiquidationPenalty} instead of ${expectDefaultLiquidationPenalty}`
    );

    await expectRevert(
      farmingPool.setLiquidationPenalty(expectZeroLiquidationPenalty, { from: nonGovernanceAccount }),
      "unauthorized"
    );

    await farmingPool.setLiquidationPenalty(expectZeroLiquidationPenalty, { from: defaultGovernanceAccount });
    const zeroLiquidationPenalty = await farmingPool.liquidationPenalty();
    assert.ok(
      zeroLiquidationPenalty.eq(expectZeroLiquidationPenalty),
      `Zero liquidation penalty is ${zeroLiquidationPenalty} instead of ${expectZeroLiquidationPenalty}`
    );
  });

  it("should not allow change liquidation penalty to greater than 100%", async () => {
    const expectLiquidationPenalty = new BN("101");

    await expectRevert(
      farmingPool.setLiquidationPenalty(expectLiquidationPenalty, { from: defaultGovernanceAccount }),
      "liquidation penalty > 100%"
    );
  });

  it("should return 10% interest rate for 0% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("0"));

    const expectIntegerBorrowNominalAnnualRate = new BN("10");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 10% interest rate for 23% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("170000000000000000", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("10");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 10% interest rate for 50% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("320000000000000000", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("10");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 17% (17.(6)% round down) interest rate for 73% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("490000000000000000", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("17");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 20% (20.33333331% round down) interest rate for 80.99999993% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("50FFFFFED35A2FA158", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("20");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 25% interest rate for 95% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("5F0000000000000000", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("25");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 55% interest rate for 97% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("610000000000000000", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("55");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 89% (89.49999895% round down) interest rate for 99.29999993% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("634CCCCBA026FC6E25", 16));

    const expectIntegerBorrowNominalAnnualRate = new BN("89");

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should return 100% interest rate for 100% utilization", async () => {
    const getBorrowNominalAnnualRate = await farmingPool.getBorrowNominalAnnualRate(new BN("640000000000000000", 16));

    const expectIntegerBorrowNominalAnnualRate = PERCENT_100;

    assert.ok(
      getBorrowNominalAnnualRate.eq(expectIntegerBorrowNominalAnnualRate),
      `integerBorrowNominalAnnualRate is ${getBorrowNominalAnnualRate} instead of ${expectIntegerBorrowNominalAnnualRate}`
    );
  });

  it("should not allow more than 100% utilization", async () => {
    await expectRevert(farmingPool.getBorrowNominalAnnualRate(new BN("640000000000000001", 16)), "> 100%");
  });

  it("should not allow accrue per second compound interest for more than 100% nominal annual rate", async () => {
    await expectRevert(farmingPool.accruePerSecondCompoundInterest(ether("1"), new BN("101"), BN_ONE), "> 100%");
  });

  it("should return correct accrue per second compound interest for 1 second at 10% nominal annual rate", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("22691.36852878"),
      new BN("10"),
      new BN("1")
    );

    const expectAccruePerSecondCompoundInterest = ether("22691.368600733857585601");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return correct accrue per second compound interest for 1 day at 10% nominal annual rate", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("2400916.73422154"),
      new BN("10"),
      new BN("86400")
    );

    const expectAccruePerSecondCompoundInterest = ether("2401574.609742940054522136");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return correct accrue per second compound interest for 7 days at 31% nominal annual rate", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("124585.727265993"),
      new BN("31"),
      new BN("604800")
    );

    const expectAccruePerSecondCompoundInterest = ether("125328.621150981489489167");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return correct accrue per second compound interest for 10 years at 100% nominal annual rate", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("2913027282.793795689645941587"),
      PERCENT_100,
      new BN("315360000")
    );

    const expectAccruePerSecondCompoundInterest = ether("64163685630009.843733308642628817");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return principal when accrue per second compound interest for 0 days", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("2913027282.793795689645941587"),
      PERCENT_100,
      new BN("0")
    );

    const expectAccruePerSecondCompoundInterest = ether("2913027282.793795689645941587");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return principal when accrue per second compound interest at 0% nominal annual rate", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("2913027282.793795689645941587"),
      new BN("0"),
      new BN("3650")
    );

    const expectAccruePerSecondCompoundInterest = ether("2913027282.793795689645941587");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return zero when accrue per second compound interest for 0 principal", async () => {
    const accruePerSecondCompoundInterest = await farmingPool.accruePerSecondCompoundInterest(
      ether("0"),
      PERCENT_100,
      new BN("3650")
    );

    const expectAccruePerSecondCompoundInterest = ether("0");

    assert.ok(
      accruePerSecondCompoundInterest.eq(expectAccruePerSecondCompoundInterest),
      `accruePerSecondCompoundInterest is ${accruePerSecondCompoundInterest} instead of ${expectAccruePerSecondCompoundInterest}`
    );
  });

  it("should return 0 seconds when exactly 0 seconds", async () => {
    const lastTimestamp = new BN("1616576603");

    const getSecondsSinceLastAccrual = await farmingPool.getSecondsSinceLastAccrual(lastTimestamp, lastTimestamp);

    const expectSecondsSinceLastAccrual = new BN("0");
    const expectAccrualTimestamp = lastTimestamp;

    assert.ok(
      getSecondsSinceLastAccrual[0].eq(expectSecondsSinceLastAccrual),
      `secondsSinceLastAccrual is ${getSecondsSinceLastAccrual[0]} instead of ${expectSecondsSinceLastAccrual}`
    );

    assert.ok(
      getSecondsSinceLastAccrual[1].eq(expectAccrualTimestamp),
      `accrualTimestamp is ${getSecondsSinceLastAccrual[1]} instead of ${expectAccrualTimestamp}`
    );
  });

  it("should return correct value when less than 1 day", async () => {
    const currentTimestamp = new BN("1616577208");

    const getSecondsSinceLastAccrual = await farmingPool.getSecondsSinceLastAccrual(
      currentTimestamp,
      new BN("1616490809")
    );

    const expectSecondsSinceLastAccrual = new BN("86399");
    const expectAccrualTimestamp = currentTimestamp;

    assert.ok(
      getSecondsSinceLastAccrual[0].eq(expectSecondsSinceLastAccrual),
      `secondsSinceLastAccrual is ${getSecondsSinceLastAccrual[0]} instead of ${expectSecondsSinceLastAccrual}`
    );

    assert.ok(
      getSecondsSinceLastAccrual[1].eq(expectAccrualTimestamp),
      `accrualTimestamp is ${getSecondsSinceLastAccrual[1]} instead of ${expectAccrualTimestamp}`
    );
  });

  it("should return correct value when more than 7 days", async () => {
    const currentTimestamp = new BN("1616577823");

    const getSecondsSinceLastAccrual = await farmingPool.getSecondsSinceLastAccrual(
      currentTimestamp,
      new BN("1615973022")
    );

    const expectSecondsSinceLastAccrual = new BN("604801");
    const expectAccrualTimestamp = currentTimestamp;

    assert.ok(
      getSecondsSinceLastAccrual[0].eq(expectSecondsSinceLastAccrual),
      `secondsSinceLastAccrual is ${getSecondsSinceLastAccrual[0]} instead of ${expectSecondsSinceLastAccrual}`
    );

    assert.ok(
      getSecondsSinceLastAccrual[1].eq(expectAccrualTimestamp),
      `accrualTimestamp is ${getSecondsSinceLastAccrual[1]} instead of ${expectAccrualTimestamp}`
    );
  });

  it("should return correct value when exactly 11 days", async () => {
    const currentTimestamp = new BN("1616578127");

    const getSecondsSinceLastAccrual = await farmingPool.getSecondsSinceLastAccrual(
      currentTimestamp,
      new BN("1615627727")
    );

    const expectSecondsSinceLastAccrual = new BN("950400");
    const expectAccrualTimestamp = currentTimestamp;

    assert.ok(
      getSecondsSinceLastAccrual[0].eq(expectSecondsSinceLastAccrual),
      `secondsSinceLastAccrual is ${getSecondsSinceLastAccrual[0]} instead of ${expectSecondsSinceLastAccrual}`
    );

    assert.ok(
      getSecondsSinceLastAccrual[1].eq(expectAccrualTimestamp),
      `accrualTimestamp is ${getSecondsSinceLastAccrual[1]} instead of ${expectAccrualTimestamp}`
    );
  });

  it("should not allow current timestamp to be less than last timestamp", async () => {
    await expectRevert(
      farmingPool.getSecondsSinceLastAccrual(new BN("1616580280"), new BN("1616580281")),
      "current before last"
    );
  });

  it("should not allow compute of borrower interest earning while paused", async () => {
    const testTreasuryPoolAddress = accounts[9];

    await farmingPool.setTreasuryPoolAddress(testTreasuryPoolAddress);
    await farmingPool.pause({ from: defaultGovernanceAccount });
    await expectRevert(farmingPool.computeBorrowerInterestEarning({ from: testTreasuryPoolAddress }), "paused");

    await farmingPool.unpause({ from: defaultGovernanceAccount });
    await assert.doesNotReject(
      async () => await farmingPool.computeBorrowerInterestEarning({ from: testTreasuryPoolAddress })
    );
  });

  it("should return 0 for compute borrower interest earning without any add or remove liquidity", async () => {
    const testTreasuryPoolAddress = accounts[9];
    await farmingPool.setTreasuryPoolAddress(testTreasuryPoolAddress);
    const estimateBorrowerInterestEarning = await farmingPool.estimateBorrowerInterestEarning();
    const computeBorrowerInterestEarning = await farmingPool.computeBorrowerInterestEarning({
      from: testTreasuryPoolAddress,
    });
    const computeBorrowerInterestEarningTimestamp = await testUtil.getBlockTimestamp(
      computeBorrowerInterestEarning.receipt.blockHash
    );
    const borrowerInterestEarningAtLastComputeValue =
      computeBorrowerInterestEarning.receipt.logs[0].args.borrowerInterestEarning;
    const borrowerInterestEarningAtLastComputeTimestamp = computeBorrowerInterestEarning.receipt.logs[0].args.timestamp;

    const expectEstimateBorrowerInterestEarning = new BN("0");
    const expectBorrowerInterestEarningAtLastComputeValue = new BN("0");
    const expactBorrowerInterestEarningAtLastComputeTimestamp = computeBorrowerInterestEarningTimestamp;

    assert.ok(
      estimateBorrowerInterestEarning.eq(expectEstimateBorrowerInterestEarning),
      `estimateBorrowerInterestEarning is ${estimateBorrowerInterestEarning} instead of ${expectEstimateBorrowerInterestEarning}`
    );

    assert.ok(
      borrowerInterestEarningAtLastComputeValue.eq(expectBorrowerInterestEarningAtLastComputeValue),
      `borrowerInterestEarningAtLastComputeValue is ${borrowerInterestEarningAtLastComputeValue} instead of ${expectBorrowerInterestEarningAtLastComputeValue}`
    );

    assert.ok(
      borrowerInterestEarningAtLastComputeTimestamp.eq(expactBorrowerInterestEarningAtLastComputeTimestamp),
      `borrowerInterestEarningAtLastComputeTimestamp is ${borrowerInterestEarningAtLastComputeTimestamp} instead of ${expactBorrowerInterestEarningAtLastComputeTimestamp}`
    );
  });

  it("should revert if insufficient underlying asset when add liquidity", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("0.000000000000000001");

    await expectRevert(farmingPool.addLiquidity(depositAmount, { from: farmer }), "insufficient underlying asset");
  });

  it("should not allow get loans at last accrual for zero address", async () => {
    await expectRevert(farmingPool.getLoansAtLastAccrualFor(ZERO_ADDRESS), "zero account");
  });

  it("should return correct loan for single deposit", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("34520.67725928");
    const secondsBetweenDepositAndComputeBorrowerInterestEarning = new BN("85681");

    const addLiquidity = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp = await testUtil.getBlockTimestamp(addLiquidity.receipt.blockHash);
    const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();

    const expectAddLiquidityAccount = farmer;
    const expectAddLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    const expectAddLiquidityAmount = depositAmount;
    const expectAddLiquidityTimestamp = addLiquidityTimestamp;

    expectEvent(addLiquidity, "AddLiquidity", {
      account: expectAddLiquidityAccount,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress,
      amount: expectAddLiquidityAmount,
      timestamp: expectAddLiquidityTimestamp,
    });

    const getLoansAtLastAccrualFor = await farmingPool.getLoansAtLastAccrualFor(farmer);
    const getPoolLoansAtLastAccrual = await farmingPool.getPoolLoansAtLastAccrual();

    const expectTotalUnderlyingAsset = depositAmount;
    const expectNumEntries = 1;
    const expectInterestRate = new BN("10");
    const expectPrincipalOnly = depositAmount.mul(new BN(LEVERAGE_FACTOR).sub(new BN(1)));
    const expectPrincipalWithInterest = expectPrincipalOnly;
    const expectLastAccrualTimestamp = expectAddLiquidityTimestamp;

    assert.ok(
      totalUnderlyingAsset.eq(expectTotalUnderlyingAsset),
      `totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectTotalUnderlyingAsset}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[0].length,
      expectNumEntries,
      `interestRates.length is ${getLoansAtLastAccrualFor[0].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[1].length,
      expectNumEntries,
      `principalsOnly.length is ${getLoansAtLastAccrualFor[1].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[2].length,
      expectNumEntries,
      `principalsWithInterest.length is ${getLoansAtLastAccrualFor[2].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[3].length,
      expectNumEntries,
      `lastAccrualTimestamps.length is ${getLoansAtLastAccrualFor[3].length} instead of ${expectNumEntries}`
    );

    assert.ok(
      getLoansAtLastAccrualFor[0][0].eq(expectInterestRate),
      `interestRate[0] is ${getLoansAtLastAccrualFor[0][0]} instead of ${expectInterestRate}`
    );

    assert.ok(
      getLoansAtLastAccrualFor[1][0].eq(expectPrincipalOnly),
      `principalOnly[0] is ${getLoansAtLastAccrualFor[1][0]} instead of ${expectPrincipalOnly}`
    );

    assert.ok(
      getLoansAtLastAccrualFor[2][0].eq(expectPrincipalWithInterest),
      `principalWithInterest[0] is ${getLoansAtLastAccrualFor[2][0]} instead of ${expectPrincipalWithInterest}`
    );

    assert.ok(
      getLoansAtLastAccrualFor[3][0].eq(expectLastAccrualTimestamp),
      `lastAccrualTimestamp[0] is ${getLoansAtLastAccrualFor[3][0]} instead of ${expectLastAccrualTimestamp}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[0].length,
      expectNumEntries,
      `poolInterestRates.length is ${getPoolLoansAtLastAccrual[0].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[1].length,
      expectNumEntries,
      `poolPrincipalsOnly.length is ${getPoolLoansAtLastAccrual[1].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[2].length,
      expectNumEntries,
      `poolPrincipalsWithInterest.length is ${getPoolLoansAtLastAccrual[2].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[3].length,
      expectNumEntries,
      `poolLastAccrualTimestamps.length is ${getPoolLoansAtLastAccrual[3].length} instead of ${expectNumEntries}`
    );

    assert.ok(
      getPoolLoansAtLastAccrual[0][0].eq(expectInterestRate),
      `poolInterestRate[0] is ${getPoolLoansAtLastAccrual[0][0]} instead of ${expectInterestRate}`
    );

    assert.ok(
      getPoolLoansAtLastAccrual[1][0].eq(expectPrincipalOnly),
      `poolPrincipalOnly[0] is ${getPoolLoansAtLastAccrual[1][0]} instead of ${expectPrincipalOnly}`
    );

    assert.ok(
      getPoolLoansAtLastAccrual[2][0].eq(expectPrincipalWithInterest),
      `poolPrincipalWithInterest[0] is ${getPoolLoansAtLastAccrual[2][0]} instead of ${expectPrincipalWithInterest}`
    );

    assert.ok(
      getPoolLoansAtLastAccrual[3][0].eq(expectLastAccrualTimestamp),
      `poolLastAccrualTimestamp[0] is ${getPoolLoansAtLastAccrual[3][0]} instead of ${expectLastAccrualTimestamp}`
    );

    await time.increase(secondsBetweenDepositAndComputeBorrowerInterestEarning);

    const testTreasuryPoolAddress = accounts[9];
    await farmingPool.setTreasuryPoolAddress(testTreasuryPoolAddress);
    const estimateBorrowerInterestEarning = await farmingPool.estimateBorrowerInterestEarning();
    const estimateBorrowerInterestEarningBlockNumber = await web3.eth.getBlockNumber();
    const estimateBorrowerInterestEarningTimestamp = await testUtil.getBlockTimestamp(
      estimateBorrowerInterestEarningBlockNumber
    );
    console.log(`estimateBorrowerInterestEarningTimestamp=${estimateBorrowerInterestEarningTimestamp}`);
    const computeBorrowerInterestEarning = await farmingPool.computeBorrowerInterestEarning({
      from: testTreasuryPoolAddress,
    });
    const computeBorrowerInterestEarningTimestamp = await testUtil.getBlockTimestamp(
      computeBorrowerInterestEarning.receipt.blockHash
    );
    const borrowerInterestEarningAtLastComputeValue =
      computeBorrowerInterestEarning.receipt.logs[0].args.borrowerInterestEarning;
    const borrowerInterestEarningAtLastComputeTimestamp = computeBorrowerInterestEarning.receipt.logs[0].args.timestamp;

    const secondsSinceDepositForEstimate = estimateBorrowerInterestEarningTimestamp.sub(addLiquidityTimestamp);
    const secondsSinceDepositForCompute = computeBorrowerInterestEarningTimestamp.sub(addLiquidityTimestamp);
    const principalOnly = parseFloat(web3.utils.fromWei(expectPrincipalOnly, "ether"));
    const expectEstimateBorrowerInterestEarning =
      principalOnly *
        calculateInterestFactor(expectInterestRate.toNumber(), secondsSinceDepositForEstimate.toNumber()) -
      principalOnly;
    const expectBorrowerInterestEarningAtLastComputeValue =
      principalOnly * calculateInterestFactor(expectInterestRate.toNumber(), secondsSinceDepositForCompute.toNumber()) -
      principalOnly;
    const expactBorrowerInterestEarningAtLastComputeTimestamp = computeBorrowerInterestEarningTimestamp;

    const estimateBorrowerInterestEarningDiff = testUtil.bnAbsDiff(
      estimateBorrowerInterestEarning,
      ether(expectEstimateBorrowerInterestEarning.toString())
    );
    assert.ok(
      estimateBorrowerInterestEarningDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `estimateBorrowerInterestEarning is ${estimateBorrowerInterestEarning} instead of ${ether(
        expectEstimateBorrowerInterestEarning.toString()
      )}`
    );

    const borrowerInterestEarningAtLastComputeValueDiff = testUtil.bnAbsDiff(
      borrowerInterestEarningAtLastComputeValue,
      ether(expectBorrowerInterestEarningAtLastComputeValue.toString())
    );
    assert.ok(
      borrowerInterestEarningAtLastComputeValueDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `borrowerInterestEarningAtLastComputeValue is ${borrowerInterestEarningAtLastComputeValue} instead of ${ether(
        expectBorrowerInterestEarningAtLastComputeValue.toString()
      )}`
    );

    assert.ok(
      borrowerInterestEarningAtLastComputeTimestamp.eq(expactBorrowerInterestEarningAtLastComputeTimestamp),
      `borrowerInterestEarningAtLastComputeTimestamp is ${borrowerInterestEarningAtLastComputeTimestamp} instead of ${expactBorrowerInterestEarningAtLastComputeTimestamp}`
    );
  });

  it("should return correct loans for 3 deposits from same user at same borrow interest rate", async () => {
    const farmer = accounts[5];

    const deposits = [
      {
        amount: ether("7158.026360665"),
        expectNumEntries: 1,
        expectInterestRate: new BN("10"),
        expectPrincipalOnly: ether("136002.500852635"),
        duration: new BN("1127223"),
      },
      {
        amount: ether("3696.764167129"),
        expectNumEntries: 1,
        expectInterestRate: new BN("10"),
        expectPrincipalOnly: ether("206241.020028086"),
        duration: new BN("8463941"),
      },
      {
        amount: ether("4378.043476570"),
        expectNumEntries: 1,
        expectInterestRate: new BN("10"),
        expectPrincipalOnly: ether("289423.846082916"),
        duration: new BN("0"),
      },
    ];

    const expectAddLiquidityAccount = farmer;
    const expectAddLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    let addLiquidityTimestamps = new Array(deposits.length).fill(0);
    let expectTotalUnderlyingAsset = new BN("0");

    for (let i = 0; i < deposits.length; i++) {
      const depositAmount = deposits[i].amount;
      const totalTreasuryPoolUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
      const totalTreasuryPoolLoanedUnderlyingAssetAmount = await treasuryPool.totalLoanedUnderlyingAssetAmount();
      const treasuryPoolUtilisationRate = await treasuryPool.getUtilisationRate();
      console.log(
        `totalTreasuryPoolUnderlyingAssetAmount=${totalTreasuryPoolUnderlyingAssetAmount}, totalTreasuryPoolLoanedUnderlyingAssetAmount=${totalTreasuryPoolLoanedUnderlyingAssetAmount}, treasuryPoolUtilisationRate=${treasuryPoolUtilisationRate}`
      );
      const addLiquidity = await addLiquidityInFarmingPool(depositAmount, farmer);
      addLiquidityTimestamps[i] = await testUtil.getBlockTimestamp(addLiquidity.receipt.blockHash);
      const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();

      const expectAddLiquidityAmount = depositAmount;
      const expectAddLiquidityTimestamp = addLiquidityTimestamps[i];

      expectEvent(addLiquidity, "AddLiquidity", {
        account: expectAddLiquidityAccount,
        underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress,
        amount: expectAddLiquidityAmount,
        timestamp: expectAddLiquidityTimestamp,
      });

      const getLoansAtLastAccrualFor = await farmingPool.getLoansAtLastAccrualFor(farmer);
      const getPoolLoansAtLastAccrual = await farmingPool.getPoolLoansAtLastAccrual();

      expectTotalUnderlyingAsset = expectTotalUnderlyingAsset.add(depositAmount);
      const expectNumEntries = deposits[i].expectNumEntries;
      const expectInterestRate = deposits[i].expectInterestRate;
      const expectPrincipalOnly = deposits[i].expectPrincipalOnly;
      const expectLastAccrualTimestamp = expectAddLiquidityTimestamp;

      let expectPrincipalWithInterest =
        parseFloat(web3.utils.fromWei(deposits[i].amount, "ether")) * (LEVERAGE_FACTOR - 1.0);
      for (let j = 0; j < i; j++) {
        const durationInSeconds = addLiquidityTimestamps[i].sub(addLiquidityTimestamps[j]);
        expectPrincipalWithInterest +=
          parseFloat(web3.utils.fromWei(deposits[j].amount, "ether")) *
          (LEVERAGE_FACTOR - 1.0) *
          calculateInterestFactor(deposits[j].expectInterestRate.toNumber(), durationInSeconds.toNumber());
      }

      assert.ok(
        totalUnderlyingAsset.eq(expectTotalUnderlyingAsset),
        `${i}: totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectTotalUnderlyingAsset}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualFor[0].length,
        expectNumEntries,
        `${i}: interestRates.length is ${getLoansAtLastAccrualFor[0].length} instead of ${expectNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualFor[1].length,
        expectNumEntries,
        `${i}: principalsOnly.length is ${getLoansAtLastAccrualFor[1].length} instead of ${expectNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualFor[2].length,
        expectNumEntries,
        `${i}: principalsWithInterest.length is ${getLoansAtLastAccrualFor[2].length} instead of ${expectNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualFor[3].length,
        expectNumEntries,
        `${i}: lastAccrualTimestamps.length is ${getLoansAtLastAccrualFor[3].length} instead of ${expectNumEntries}`
      );

      assert.ok(
        getLoansAtLastAccrualFor[0][0].eq(expectInterestRate),
        `${i}: interestRate[0] is ${getLoansAtLastAccrualFor[0][0]} instead of ${expectInterestRate}`
      );

      assert.ok(
        getLoansAtLastAccrualFor[1][0].eq(expectPrincipalOnly),
        `${i}: principalOnly[0] is ${getLoansAtLastAccrualFor[1][0]} instead of ${expectPrincipalOnly}`
      );

      const principalWithInterestDiff = testUtil.bnAbsDiff(
        getLoansAtLastAccrualFor[2][0],
        ether(expectPrincipalWithInterest.toString())
      );
      assert.ok(
        principalWithInterestDiff.lte(BN_POINT_ZERO_SQUARE_FIVE),
        `${i}: principalWithInterest[0] is ${getLoansAtLastAccrualFor[2][0]} instead of ${ether(
          expectPrincipalWithInterest.toString()
        )}`
      );

      assert.ok(
        getLoansAtLastAccrualFor[3][0].eq(expectLastAccrualTimestamp),
        `${i}: lastAccrualTimestamp[0] is ${getLoansAtLastAccrualFor[3][0]} instead of ${expectLastAccrualTimestamp}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrual[0].length,
        expectNumEntries,
        `${i}: poolInterestRates.length is ${getPoolLoansAtLastAccrual[0].length} instead of ${expectNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrual[1].length,
        expectNumEntries,
        `${i}: poolPrincipalsOnly.length is ${getPoolLoansAtLastAccrual[1].length} instead of ${expectNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrual[2].length,
        expectNumEntries,
        `${i}: poolPrincipalsWithInterest.length is ${getPoolLoansAtLastAccrual[2].length} instead of ${expectNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrual[3].length,
        expectNumEntries,
        `${i}: poolLastAccrualTimestamps.length is ${getPoolLoansAtLastAccrual[3].length} instead of ${expectNumEntries}`
      );

      assert.ok(
        getPoolLoansAtLastAccrual[0][0].eq(expectInterestRate),
        `${i}: poolInterestRate[0] is ${getPoolLoansAtLastAccrual[0][0]} instead of ${expectInterestRate}`
      );

      assert.ok(
        getPoolLoansAtLastAccrual[1][0].eq(expectPrincipalOnly),
        `${i}: poolPrincipalOnly[0] is ${getPoolLoansAtLastAccrual[1][0]} instead of ${expectPrincipalOnly}`
      );

      const poolPrincipalWithInterestDiff = testUtil.bnAbsDiff(
        getPoolLoansAtLastAccrual[2][0],
        ether(expectPrincipalWithInterest.toString())
      );
      assert.ok(
        poolPrincipalWithInterestDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
        `${i}: poolPrincipalWithInterest[0] is ${getPoolLoansAtLastAccrual[2][0]} instead of ${ether(
          expectPrincipalWithInterest.toString()
        )}`
      );

      assert.ok(
        getPoolLoansAtLastAccrual[3][0].eq(expectLastAccrualTimestamp),
        `${i}: poolLastAccrualTimestamp[0] is ${getPoolLoansAtLastAccrual[3][0]} instead of ${expectLastAccrualTimestamp}`
      );

      if (deposits[i].duration.gt(new BN("0"))) {
        await time.increase(deposits[i].duration);
      }
    }
  });

  it("should not allow get total transfer to adapter for zero address", async () => {
    const farmer = accounts[5];

    await expectRevert(farmingPool.getTotalTransferToAdapterFor(ZERO_ADDRESS, { from: farmer }), "zero account");
  });

  it("should not allow adding of 0 liquidity", async () => {
    const farmer = accounts[5];

    await expectRevert(farmingPool.addLiquidity(ether("0"), { from: farmer }), "0 amount");
  });

  it("should not allow adding of liquidity while paused", async () => {
    const farmer = accounts[5];

    await farmingPool.pause({ from: defaultGovernanceAccount });
    await expectRevert(farmingPool.addLiquidity(ether("1"), { from: farmer }), "paused");
  });

  it("should return correct loan after single deposit and single withdrawal of different amount by same user", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("29395.02795689645941587");
    const withdrawAmount = ether("6272.930726141791638553");
    const secsBetweenDepositWithdraw = new BN("915346");
    const secondsBetweenWithdrawAndComputeBorrowerInterestEarning = new BN("433745");

    const addLiquidity = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp = await testUtil.getBlockTimestamp(addLiquidity.receipt.blockHash);

    const expectAddLiquidityAccount = farmer;
    const expectAddLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    const expectAddLiquidityAmount = depositAmount;
    const expectAddLiquidityTimestamp = addLiquidityTimestamp;

    expectEvent(addLiquidity, "AddLiquidity", {
      account: expectAddLiquidityAccount,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress,
      amount: expectAddLiquidityAmount,
      timestamp: expectAddLiquidityTimestamp,
    });

    await time.increase(secsBetweenDepositWithdraw);

    const totalTransferToAdapter = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance = await btoken.balanceOf(farmer);
    console.log(`totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}`);
    const getLoansAtLastAccrualForBeforeWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw[3][0]}`
    );

    const insuranceFundBeforeRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
    const removeLiquidity = await farmingPool.removeLiquidity(withdrawAmount, { from: farmer });
    const removeLiquidityTimestamp = await testUtil.getBlockTimestamp(removeLiquidity.receipt.blockHash);
    const insuranceFundAfterRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance = insuranceFundAfterRemove.sub(insuranceFundBeforeRemove);
    const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();

    const outstandingInterest = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw,
      removeLiquidityTimestamp
    );

    const expectRemoveLiquidityAccount = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    const expectRemoveLiquidityRequestedAmount = withdrawAmount;
    const expectRemoveLiquidityActualAmount = withdrawAmount;
    const expectRemoveLiquidityTimestamp = removeLiquidityTimestamp;

    expectEvent(removeLiquidity, "RemoveLiquidity", {
      account: expectRemoveLiquidityAccount,
      underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress,
      requestedAmount: expectRemoveLiquidityRequestedAmount,
      actualAmount: expectRemoveLiquidityActualAmount,
      timestamp: expectRemoveLiquidityTimestamp,
    });

    const outstandingInterestDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.outstandingInterest,
      outstandingInterest
    );
    assert.ok(
      outstandingInterestDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `EventRemoveLiquidity.outstandingInterest is ${removeLiquidity.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest}`
    );

    const getLoansAtLastAccrualFor = await farmingPool.getLoansAtLastAccrualFor(farmer);
    const getPoolLoansAtLastAccrual = await farmingPool.getPoolLoansAtLastAccrual();

    const repaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      removeLiquidity.receipt.logs[0].args.actualAmount,
      removeLiquidity.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter,
      btokenBalance,
      outstandingInterest
    );
    console.log(
      `RemoveLiquidityEvent: requestedAmount=${removeLiquidity.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity.receipt.logs[0].args.timestamp}`
    );
    const loanPrincipalToRepayDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.loanPrincipalToRepay,
      repaymentDetails.loanPrincipalToRepay
    );
    assert.ok(
      loanPrincipalToRepayDiff.lte(BN_ONE),
      `EventRemoveLiquidity.loanPrincipalToRepay is ${removeLiquidity.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails.loanPrincipalToRepay}`
    );
    const payableInterestDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.payableInterest,
      repaymentDetails.payableInterest
    );
    assert.ok(
      payableInterestDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity.payableInterest is ${removeLiquidity.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails.payableInterest}`
    );
    assert.ok(
      removeLiquidity.receipt.logs[0].args.taxAmount.eq(repaymentDetails.taxAmount),
      `EventRemoveLiquidity.taxAmount is ${removeLiquidity.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails.taxAmount}`
    );
    const receiveQuantityDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.receiveQuantity,
      repaymentDetails.amountToReceive
    );
    assert.ok(
      receiveQuantityDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity.receiveQuantity is ${removeLiquidity.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails.amountToReceive}`
    );

    const expectTotalUnderlyingAsset = depositAmount.sub(repaymentDetails.depositPrincipal);
    const expectNumEntries = 1;
    const expectInterestRate = new BN("10");
    const expectPrincipalOnly = depositAmount
      .mul(new BN(LEVERAGE_FACTOR - 1))
      .sub(repaymentDetails.loanPrincipalToRepay);
    const expectPrincipalWithInterest = getLoansAtLastAccrualForBeforeWithdraw[2][0]
      .sub(repaymentDetails.loanPrincipalToRepay)
      .sub(repaymentDetails.payableInterest);
    const expectLastAccrualTimestamp = expectRemoveLiquidityTimestamp;
    const expectInsuranceFundBalance = repaymentDetails.taxAmount;

    assert.ok(
      insuranceFundBalance.eq(expectInsuranceFundBalance),
      `insuranceFundBalance is ${insuranceFundBalance} instead of ${expectInsuranceFundBalance}`
    );

    assert.ok(
      totalUnderlyingAsset.eq(expectTotalUnderlyingAsset),
      `totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectTotalUnderlyingAsset}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[0].length,
      expectNumEntries,
      `interestRates.length is ${getLoansAtLastAccrualFor[0].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[1].length,
      expectNumEntries,
      `principalsOnly.length is ${getLoansAtLastAccrualFor[1].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[2].length,
      expectNumEntries,
      `principalsWithInterest.length is ${getLoansAtLastAccrualFor[2].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualFor[3].length,
      expectNumEntries,
      `lastAccrualTimestamps.length is ${getLoansAtLastAccrualFor[3].length} instead of ${expectNumEntries}`
    );

    assert.ok(
      getLoansAtLastAccrualFor[0][0].eq(expectInterestRate),
      `interestRate[0] is ${getLoansAtLastAccrualFor[0][0]} instead of ${expectInterestRate}`
    );

    const loansPrincipalOnlyDiff = testUtil.bnAbsDiff(getLoansAtLastAccrualFor[1][0], expectPrincipalOnly);
    assert.ok(
      loansPrincipalOnlyDiff.lte(BN_ONE),
      `principalOnly[0] is ${getLoansAtLastAccrualFor[1][0]} instead of ${expectPrincipalOnly}`
    );

    const principalWithInterestDiff = testUtil.bnAbsDiff(getLoansAtLastAccrualFor[2][0], expectPrincipalWithInterest);
    assert.ok(
      principalWithInterestDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `principalWithInterest[0] is ${getLoansAtLastAccrualFor[2][0]} instead of ${expectPrincipalWithInterest}`
    );

    assert.ok(
      getLoansAtLastAccrualFor[3][0].eq(expectLastAccrualTimestamp),
      `lastAccrualTimestamp[0] is ${getLoansAtLastAccrualFor[3][0]} instead of ${expectLastAccrualTimestamp}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[0].length,
      expectNumEntries,
      `poolInterestRates.length is ${getPoolLoansAtLastAccrual[0].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[1].length,
      expectNumEntries,
      `poolPrincipalsOnly.length is ${getPoolLoansAtLastAccrual[1].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[2].length,
      expectNumEntries,
      `poolPrincipalsWithInterest.length is ${getPoolLoansAtLastAccrual[2].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getPoolLoansAtLastAccrual[3].length,
      expectNumEntries,
      `poolLastAccrualTimestamps.length is ${getPoolLoansAtLastAccrual[3].length} instead of ${expectNumEntries}`
    );

    assert.ok(
      getPoolLoansAtLastAccrual[0][0].eq(expectInterestRate),
      `poolInterestRate[0] is ${getPoolLoansAtLastAccrual[0][0]} instead of ${expectInterestRate}`
    );

    const poolLoansPrincipalOnlyDiff = testUtil.bnAbsDiff(getPoolLoansAtLastAccrual[1][0], expectPrincipalOnly);
    assert.ok(
      poolLoansPrincipalOnlyDiff.lte(BN_ONE),
      `poolPrincipalOnly[0] is ${getPoolLoansAtLastAccrual[1][0]} instead of ${expectPrincipalOnly}`
    );

    const poolPrincipalWithInterestDiff = testUtil.bnAbsDiff(
      getPoolLoansAtLastAccrual[2][0],
      expectPrincipalWithInterest
    );
    assert.ok(
      poolPrincipalWithInterestDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `poolPrincipalWithInterest[0] is ${getPoolLoansAtLastAccrual[2][0]} instead of ${expectPrincipalWithInterest}`
    );

    assert.ok(
      getPoolLoansAtLastAccrual[3][0].eq(expectLastAccrualTimestamp),
      `poolLastAccrualTimestamp[0] is ${getPoolLoansAtLastAccrual[3][0]} instead of ${expectLastAccrualTimestamp}`
    );

    await expectRevert(
      farmingPool.removeLiquidity(depositAmount.mul(new BN("20")), {
        from: farmer,
      }),
      "insufficient BToken"
    );

    await time.increase(secondsBetweenWithdrawAndComputeBorrowerInterestEarning);

    const testTreasuryPoolAddress = accounts[9];
    await farmingPool.setTreasuryPoolAddress(testTreasuryPoolAddress);
    const estimateBorrowerInterestEarning = await farmingPool.estimateBorrowerInterestEarning();
    const estimateBorrowerInterestEarningBlockNumber = await web3.eth.getBlockNumber();
    const estimateBorrowerInterestEarningTimestamp = await testUtil.getBlockTimestamp(
      estimateBorrowerInterestEarningBlockNumber
    );
    console.log(`estimateBorrowerInterestEarningTimestamp=${estimateBorrowerInterestEarningTimestamp}`);
    const computeBorrowerInterestEarning = await farmingPool.computeBorrowerInterestEarning({
      from: testTreasuryPoolAddress,
    });
    const computeBorrowerInterestEarningTimestamp = await testUtil.getBlockTimestamp(
      computeBorrowerInterestEarning.receipt.blockHash
    );
    const borrowerInterestEarningAtLastComputeValue =
      computeBorrowerInterestEarning.receipt.logs[0].args.borrowerInterestEarning;
    const borrowerInterestEarningAtLastComputeTimestamp = computeBorrowerInterestEarning.receipt.logs[0].args.timestamp;

    const secondsBetweenDepositAndWithdraw = removeLiquidityTimestamp.sub(addLiquidityTimestamp);
    const secondsSinceWithdrawForEstimate = estimateBorrowerInterestEarningTimestamp.sub(removeLiquidityTimestamp);
    const secondsSinceWithdrawForCompute = computeBorrowerInterestEarningTimestamp.sub(removeLiquidityTimestamp);
    const principalOnlyAfterDeposit = parseFloat(
      web3.utils.fromWei(depositAmount.mul(new BN(LEVERAGE_FACTOR - 1)), "ether")
    );
    const principalWithInterestBeforeWithdraw =
      principalOnlyAfterDeposit *
      calculateInterestFactor(expectInterestRate.toNumber(), secondsBetweenDepositAndWithdraw.toNumber());
    const principalWithInterestAfterWithdraw =
      principalWithInterestBeforeWithdraw -
      parseFloat(
        web3.utils.fromWei(repaymentDetails.loanPrincipalToRepay.add(repaymentDetails.payableInterest)),
        "ether"
      );
    const principalOnlyAfterWithdraw =
      principalOnlyAfterDeposit - parseFloat(web3.utils.fromWei(repaymentDetails.loanPrincipalToRepay), "ether");
    const expectEstimateBorrowerInterestEarning =
      principalWithInterestAfterWithdraw *
        calculateInterestFactor(expectInterestRate.toNumber(), secondsSinceWithdrawForEstimate.toNumber()) -
      principalOnlyAfterWithdraw;
    const expectBorrowerInterestEarningAtLastComputeValue =
      principalWithInterestAfterWithdraw *
        calculateInterestFactor(expectInterestRate.toNumber(), secondsSinceWithdrawForCompute.toNumber()) -
      principalOnlyAfterWithdraw;
    const expactBorrowerInterestEarningAtLastComputeTimestamp = computeBorrowerInterestEarningTimestamp;

    const estimateBorrowerInterestEarningDiff = testUtil.bnAbsDiff(
      estimateBorrowerInterestEarning,
      ether(expectEstimateBorrowerInterestEarning.toString())
    );
    assert.ok(
      estimateBorrowerInterestEarningDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `estimateBorrowerInterestEarning is ${estimateBorrowerInterestEarning} instead of ${ether(
        expectEstimateBorrowerInterestEarning.toString()
      )}`
    );

    const borrowerInterestEarningAtLastComputeValueDiff = testUtil.bnAbsDiff(
      borrowerInterestEarningAtLastComputeValue,
      ether(expectBorrowerInterestEarningAtLastComputeValue.toString())
    );
    assert.ok(
      borrowerInterestEarningAtLastComputeValueDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `borrowerInterestEarningAtLastComputeValue is ${borrowerInterestEarningAtLastComputeValue} instead of ${ether(
        expectBorrowerInterestEarningAtLastComputeValue.toString()
      )}`
    );

    assert.ok(
      borrowerInterestEarningAtLastComputeTimestamp.eq(expactBorrowerInterestEarningAtLastComputeTimestamp),
      `borrowerInterestEarningAtLastComputeTimestamp is ${borrowerInterestEarningAtLastComputeTimestamp} instead of ${expactBorrowerInterestEarningAtLastComputeTimestamp}`
    );
  });

  it("should return correct loan after single deposit and single full withdrawal by same user", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("5471.794300200471887152");
    const secsBetweenDepositWithdraw = new BN("633988");

    const addLiquidity = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp = await testUtil.getBlockTimestamp(addLiquidity.receipt.blockHash);

    const withdrawAmount = addLiquidity.receipt.logs[0].args.receiveQuantity;
    console.log(`addLiquidityTimestamp=${addLiquidityTimestamp}, withdrawAmount=${withdrawAmount}`);
    const expectAddLiquidityAccount = farmer;
    const expectAddLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    const expectAddLiquidityAmount = depositAmount;
    const expectAddLiquidityTimestamp = addLiquidityTimestamp;

    expectEvent(addLiquidity, "AddLiquidity", {
      account: expectAddLiquidityAccount,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress,
      amount: expectAddLiquidityAmount,
      timestamp: expectAddLiquidityTimestamp,
    });

    await time.increase(secsBetweenDepositWithdraw);

    const farmingPoolUnderlyingAssetBalance = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance=${farmingPoolUnderlyingAssetBalance}, totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw[3][0]}`
    );

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const currentBlockTimestamp = await testUtil.getBlockTimestamp(currentBlockNumber);
    console.log(`currentBlockTimestamp=${currentBlockTimestamp}`);
    const outstandingInterestTemp = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw,
      currentBlockTimestamp
    );
    const repaymentDetailsTemp = calculateRepaymentDetails(
      TAX_RATE,
      withdrawAmount,
      withdrawAmount.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter,
      btokenBalance,
      outstandingInterestTemp
    );
    console.log(
      `repaymentDetailsTemp: outstandingInterestTemp=${outstandingInterestTemp}, underlyingAssetInvested=${repaymentDetailsTemp.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp.taxAmount}, payableInterest=${repaymentDetailsTemp.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp.amountToReceive}`
    );

    const insuranceFundBeforeRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
    const removeLiquidity = await farmingPool.removeLiquidity(withdrawAmount, { from: farmer });
    const removeLiquidityTimestamp = await testUtil.getBlockTimestamp(removeLiquidity.receipt.blockHash);
    console.log(`removeLiquidityTimestamp=${removeLiquidityTimestamp}`);
    const insuranceFundAfterRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance = insuranceFundAfterRemove.sub(insuranceFundBeforeRemove);
    const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw,
      removeLiquidityTimestamp
    );
    console.log(`outstandingInterest=${outstandingInterest}`);
    console.log(
      `RemoveLiquidityEvent: requestedAmount=${removeLiquidity.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity.receipt.logs[0].args.timestamp}`
    );

    const expectRemoveLiquidityAccount = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    const expectRemoveLiquidityRequestedAmount = withdrawAmount;
    const expectRemoveLiquidityActualAmount = withdrawAmount;
    const expectRemoveLiquidityTimestamp = removeLiquidityTimestamp;

    expectEvent(removeLiquidity, "RemoveLiquidity", {
      account: expectRemoveLiquidityAccount,
      underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress,
      requestedAmount: expectRemoveLiquidityRequestedAmount,
      actualAmount: expectRemoveLiquidityActualAmount,
      timestamp: expectRemoveLiquidityTimestamp,
    });

    const outstandingInterestDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.outstandingInterest,
      outstandingInterest
    );
    assert.ok(
      outstandingInterestDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `EventRemoveLiquidity.outstandingInterest is ${removeLiquidity.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest}`
    );

    const getLoansAtLastAccrualForAfterWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      removeLiquidity.receipt.logs[0].args.actualAmount,
      removeLiquidity.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter,
      btokenBalance,
      outstandingInterest
    );
    console.log(
      `requestedAmount=${removeLiquidity.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}`
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails.underlyingAssetInvested}, taxAmount=${repaymentDetails.taxAmount}, payableInterest=${repaymentDetails.payableInterest}, loanPrincipalToRepay=${repaymentDetails.loanPrincipalToRepay}, amountToReceive=${repaymentDetails.amountToReceive}`
    );

    assert.ok(
      removeLiquidity.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails.loanPrincipalToRepay),
      `EventRemoveLiquidity.loanPrincipalToRepay is ${removeLiquidity.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails.loanPrincipalToRepay}`
    );
    const payableInterestDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.payableInterest,
      repaymentDetails.payableInterest
    );
    assert.ok(
      payableInterestDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `EventRemoveLiquidity.payableInterest is ${removeLiquidity.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails.payableInterest}`
    );
    assert.ok(
      removeLiquidity.receipt.logs[0].args.taxAmount.eq(repaymentDetails.taxAmount),
      `EventRemoveLiquidity.taxAmount is ${removeLiquidity.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails.taxAmount}`
    );
    const receiveQuantityDiff = testUtil.bnAbsDiff(
      removeLiquidity.receipt.logs[0].args.receiveQuantity,
      repaymentDetails.amountToReceive
    );
    assert.ok(
      receiveQuantityDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity.receiveQuantity is ${removeLiquidity.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails.amountToReceive}`
    );

    const expectTotalUnderlyingAsset = new BN("0");
    const expectNumEntries = 0;
    const expectInsuranceFundBalance = repaymentDetails.taxAmount;

    assert.ok(
      insuranceFundBalance.eq(expectInsuranceFundBalance),
      `insuranceFundBalance is ${insuranceFundBalance} instead of ${expectInsuranceFundBalance}`
    );

    assert.ok(
      totalUnderlyingAsset.eq(expectTotalUnderlyingAsset),
      `totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectTotalUnderlyingAsset}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[0].length,
      expectNumEntries,
      `interestRates.length is ${getLoansAtLastAccrualForAfterWithdraw[0].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[1].length,
      expectNumEntries,
      `principalsOnly.length is ${getLoansAtLastAccrualForAfterWithdraw[1].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[2].length,
      expectNumEntries,
      `principalsWithInterest.length is ${getLoansAtLastAccrualForAfterWithdraw[2].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[3].length,
      expectNumEntries,
      `lastAccrualTimestamps.length is ${getLoansAtLastAccrualForAfterWithdraw[3].length} instead of ${expectNumEntries}`
    );

    const totalTransferToAdapterForFarmer = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer.eq(expectTotalTransferToAdapterForFarmer),
      `totalTransferToAdapterForFarmer is ${totalTransferToAdapterForFarmer} instead of ${expectTotalTransferToAdapterForFarmer}`
    );
  });

  it("should return correct loan after single deposit and single full withdrawal by same user twice", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("7480.339726523336354100");
    const secsBetweenDepositWithdraw = new BN("317993");
    const secsBetweenDeposits = new BN("67");

    const addLiquidity01 = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const withdrawAmount01 = addLiquidity01.receipt.logs[0].args.receiveQuantity;
    console.log(`addLiquidityTimestamp01=${addLiquidityTimestamp01}, withdrawAmount01=${withdrawAmount01}`);
    const expectAddLiquidityAccount01 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectAddLiquidityAmount01 = depositAmount;
    const expectAddLiquidityTimestamp01 = addLiquidityTimestamp01;

    expectEvent(addLiquidity01, "AddLiquidity", {
      account: expectAddLiquidityAccount01,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress01,
      amount: expectAddLiquidityAmount01,
      timestamp: expectAddLiquidityTimestamp01,
    });

    await time.increase(secsBetweenDepositWithdraw);

    const farmingPoolUnderlyingAssetBalance01 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance01 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance01=${farmingPoolUnderlyingAssetBalance01}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw01: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw01[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw01[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw01[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw01[3][0]}`
    );

    const currentBlockNumber01 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp01 = await testUtil.getBlockTimestamp(currentBlockNumber01);
    console.log(`currentBlockTimestamp01=${currentBlockTimestamp01}`);
    const outstandingInterestTemp01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      currentBlockTimestamp01
    );
    const repaymentDetailsTemp01 = calculateRepaymentDetails(
      TAX_RATE,
      withdrawAmount01,
      withdrawAmount01.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterestTemp01
    );
    console.log(
      `repaymentDetailsTemp01: outstandingInterestTemp01=${outstandingInterestTemp01}, underlyingAssetInvested=${repaymentDetailsTemp01.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp01.taxAmount}, payableInterest=${repaymentDetailsTemp01.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp01.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp01.amountToReceive}`
    );

    const insuranceFundBeforeRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const removeLiquidity01 = await farmingPool.removeLiquidity(withdrawAmount01, { from: farmer });
    const removeLiquidityTimestamp01 = await testUtil.getBlockTimestamp(removeLiquidity01.receipt.blockHash);
    console.log(`removeLiquidityTimestamp01=${removeLiquidityTimestamp01}`);
    const insuranceFundAfterRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance01 = insuranceFundAfterRemove01.sub(insuranceFundBeforeRemove01);
    const totalUnderlyingAsset01 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      removeLiquidityTimestamp01
    );
    console.log(`outstandingInterest01=${outstandingInterest01}`);
    console.log(
      `RemoveLiquidityEvent01: requestedAmount=${removeLiquidity01.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity01.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity01.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity01.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity01.receipt.logs[0].args.timestamp}`
    );

    const expectRemoveLiquidityAccount01 = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectRemoveLiquidityRequestedAmount01 = withdrawAmount01;
    const expectRemoveLiquidityActualAmount01 = withdrawAmount01;
    const expectRemoveLiquidityTimestamp01 = removeLiquidityTimestamp01;

    expectEvent(removeLiquidity01, "RemoveLiquidity", {
      account: expectRemoveLiquidityAccount01,
      underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress01,
      requestedAmount: expectRemoveLiquidityRequestedAmount01,
      actualAmount: expectRemoveLiquidityActualAmount01,
      timestamp: expectRemoveLiquidityTimestamp01,
    });

    const outstandingInterest01Diff = testUtil.bnAbsDiff(
      removeLiquidity01.receipt.logs[0].args.outstandingInterest,
      outstandingInterest01
    );
    assert.ok(
      outstandingInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity01.outstandingInterest is ${removeLiquidity01.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest01}`
    );

    const getLoansAtLastAccrualForAfterWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails01 = calculateRepaymentDetails(
      TAX_RATE,
      removeLiquidity01.receipt.logs[0].args.actualAmount,
      removeLiquidity01.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterest01
    );
    console.log(
      `requestedAmount01=${removeLiquidity01.receipt.logs[0].args.requestedAmount}, actualAmount01=${removeLiquidity01.receipt.logs[0].args.actualAmount}, adapterTransfer01=${removeLiquidity01.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    console.log(
      `repaymentDetails01: underlyingAssetInvested=${repaymentDetails01.underlyingAssetInvested}, taxAmount=${repaymentDetails01.taxAmount}, payableInterest=${repaymentDetails01.payableInterest}, loanPrincipalToRepay=${repaymentDetails01.loanPrincipalToRepay}, amountToReceive=${repaymentDetails01.amountToReceive}`
    );

    assert.ok(
      removeLiquidity01.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails01.loanPrincipalToRepay),
      `EventRemoveLiquidity01.loanPrincipalToRepay is ${removeLiquidity01.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails01.loanPrincipalToRepay}`
    );
    const payableInterest01Diff = testUtil.bnAbsDiff(
      removeLiquidity01.receipt.logs[0].args.payableInterest,
      repaymentDetails01.payableInterest
    );
    assert.ok(
      payableInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity01.payableInterest is ${removeLiquidity01.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails01.payableInterest}`
    );
    assert.ok(
      removeLiquidity01.receipt.logs[0].args.taxAmount.eq(repaymentDetails01.taxAmount),
      `EventRemoveLiquidity01.taxAmount is ${removeLiquidity01.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails01.taxAmount}`
    );
    const receiveQuantity01Diff = testUtil.bnAbsDiff(
      removeLiquidity01.receipt.logs[0].args.receiveQuantity,
      repaymentDetails01.amountToReceive
    );
    assert.ok(
      receiveQuantity01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity01.receiveQuantity is ${removeLiquidity01.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails01.amountToReceive}`
    );

    const expectTotalUnderlyingAsset01 = new BN("0");
    const expectNumEntries01 = 0;
    const expectInsuranceFundBalance01 = repaymentDetails01.taxAmount;

    assert.ok(
      insuranceFundBalance01.eq(expectInsuranceFundBalance01),
      `insuranceFundBalance01 is ${insuranceFundBalance01} instead of ${expectInsuranceFundBalance01}`
    );

    assert.ok(
      totalUnderlyingAsset01.eq(expectTotalUnderlyingAsset01),
      `totalUnderlyingAsset01 is ${totalUnderlyingAsset01} instead of ${expectTotalUnderlyingAsset01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[0].length,
      expectNumEntries01,
      `interestRates01.length is ${getLoansAtLastAccrualForAfterWithdraw01[0].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[1].length,
      expectNumEntries01,
      `principalsOnly01.length is ${getLoansAtLastAccrualForAfterWithdraw01[1].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[2].length,
      expectNumEntries01,
      `principalsWithInterest01.length is ${getLoansAtLastAccrualForAfterWithdraw01[2].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[3].length,
      expectNumEntries01,
      `lastAccrualTimestamps01.length is ${getLoansAtLastAccrualForAfterWithdraw01[3].length} instead of ${expectNumEntries01}`
    );

    const totalTransferToAdapterForFarmer01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer01 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer01.eq(expectTotalTransferToAdapterForFarmer01),
      `totalTransferToAdapterForFarmer01 is ${totalTransferToAdapterForFarmer01} instead of ${expectTotalTransferToAdapterForFarmer01}`
    );

    await time.increase(secsBetweenDeposits);

    const addLiquidity02 = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const withdrawAmount02 = addLiquidity02.receipt.logs[0].args.receiveQuantity;
    console.log(`addLiquidityTimestamp02=${addLiquidityTimestamp02}, withdrawAmount02=${withdrawAmount02}`);
    const expectAddLiquidityAccount02 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectAddLiquidityAmount02 = depositAmount;
    const expectAddLiquidityTimestamp02 = addLiquidityTimestamp02;

    expectEvent(addLiquidity02, "AddLiquidity", {
      account: expectAddLiquidityAccount02,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress02,
      amount: expectAddLiquidityAmount02,
      timestamp: expectAddLiquidityTimestamp02,
    });

    await time.increase(secsBetweenDepositWithdraw);

    const farmingPoolUnderlyingAssetBalance02 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance02 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance02=${farmingPoolUnderlyingAssetBalance02}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw02: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw02[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw02[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw02[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw02[3][0]}`
    );

    const currentBlockNumber02 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp02 = await testUtil.getBlockTimestamp(currentBlockNumber02);
    console.log(`currentBlockTimestamp02=${currentBlockTimestamp02}`);
    const outstandingInterestTemp02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      currentBlockTimestamp02
    );
    const repaymentDetailsTemp02 = calculateRepaymentDetails(
      TAX_RATE,
      withdrawAmount02,
      withdrawAmount02.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterestTemp02
    );
    console.log(
      `repaymentDetailsTemp02: outstandingInterestTemp02=${outstandingInterestTemp02}, underlyingAssetInvested=${repaymentDetailsTemp02.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp02.taxAmount}, payableInterest=${repaymentDetailsTemp02.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp02.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp02.amountToReceive}`
    );

    const insuranceFundBeforeRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const removeLiquidity02 = await farmingPool.removeLiquidity(withdrawAmount02, { from: farmer });
    const removeLiquidityTimestamp02 = await testUtil.getBlockTimestamp(removeLiquidity02.receipt.blockHash);
    console.log(`removeLiquidityTimestamp02=${removeLiquidityTimestamp02}`);
    const insuranceFundAfterRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance02 = insuranceFundAfterRemove02.sub(insuranceFundBeforeRemove02);
    const totalUnderlyingAsset02 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      removeLiquidityTimestamp02
    );
    console.log(`outstandingInterest02=${outstandingInterest02}`);
    console.log(
      `RemoveLiquidityEvent02: requestedAmount=${removeLiquidity02.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity02.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity02.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity02.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity02.receipt.logs[0].args.timestamp}`
    );

    const expectRemoveLiquidityAccount02 = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectRemoveLiquidityRequestedAmount02 = withdrawAmount02;
    const expectRemoveLiquidityActualAmount02 = withdrawAmount02;
    const expectRemoveLiquidityTimestamp02 = removeLiquidityTimestamp02;

    expectEvent(removeLiquidity02, "RemoveLiquidity", {
      account: expectRemoveLiquidityAccount02,
      underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress02,
      requestedAmount: expectRemoveLiquidityRequestedAmount02,
      actualAmount: expectRemoveLiquidityActualAmount02,
      timestamp: expectRemoveLiquidityTimestamp02,
    });

    const outstandingInterest02Diff = testUtil.bnAbsDiff(
      removeLiquidity02.receipt.logs[0].args.outstandingInterest,
      outstandingInterest02
    );
    assert.ok(
      outstandingInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity02.outstandingInterest is ${removeLiquidity02.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest02}`
    );

    const getLoansAtLastAccrualForAfterWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      removeLiquidity02.receipt.logs[0].args.actualAmount,
      removeLiquidity02.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterest02
    );
    console.log(
      `requestedAmount02=${removeLiquidity02.receipt.logs[0].args.requestedAmount}, actualAmount02=${removeLiquidity02.receipt.logs[0].args.actualAmount}, adapterTransfer02=${removeLiquidity02.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    console.log(
      `repaymentDetails02: underlyingAssetInvested=${repaymentDetails02.underlyingAssetInvested}, taxAmount=${repaymentDetails02.taxAmount}, payableInterest=${repaymentDetails02.payableInterest}, loanPrincipalToRepay=${repaymentDetails02.loanPrincipalToRepay}, amountToReceive=${repaymentDetails02.amountToReceive}`
    );

    assert.ok(
      removeLiquidity02.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails02.loanPrincipalToRepay),
      `EventRemoveLiquidity02.loanPrincipalToRepay is ${removeLiquidity02.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails02.loanPrincipalToRepay}`
    );
    const payableInterest02Diff = testUtil.bnAbsDiff(
      removeLiquidity02.receipt.logs[0].args.payableInterest,
      repaymentDetails02.payableInterest
    );
    assert.ok(
      payableInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity02.payableInterest is ${removeLiquidity02.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails02.payableInterest}`
    );
    assert.ok(
      removeLiquidity02.receipt.logs[0].args.taxAmount.eq(repaymentDetails02.taxAmount),
      `EventRemoveLiquidity02.taxAmount is ${removeLiquidity02.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails02.taxAmount}`
    );
    const receiveQuantity02Diff = testUtil.bnAbsDiff(
      removeLiquidity02.receipt.logs[0].args.receiveQuantity,
      repaymentDetails02.amountToReceive
    );
    assert.ok(
      receiveQuantity02Diff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `EventRemoveLiquidity02.receiveQuantity is ${removeLiquidity02.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails02.amountToReceive}`
    );

    const expectTotalUnderlyingAsset02 = new BN("0");
    const expectNumEntries02 = 0;
    const expectInsuranceFundBalance02 = repaymentDetails02.taxAmount;

    assert.ok(
      insuranceFundBalance02.eq(expectInsuranceFundBalance02),
      `insuranceFundBalance02 is ${insuranceFundBalance02} instead of ${expectInsuranceFundBalance02}`
    );

    assert.ok(
      totalUnderlyingAsset02.eq(expectTotalUnderlyingAsset02),
      `totalUnderlyingAsset02 is ${totalUnderlyingAsset02} instead of ${expectTotalUnderlyingAsset02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[0].length,
      expectNumEntries02,
      `interestRates02.length is ${getLoansAtLastAccrualForAfterWithdraw02[0].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[1].length,
      expectNumEntries02,
      `principalsOnly02.length is ${getLoansAtLastAccrualForAfterWithdraw02[1].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[2].length,
      expectNumEntries02,
      `principalsWithInterest02.length is ${getLoansAtLastAccrualForAfterWithdraw02[2].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[3].length,
      expectNumEntries02,
      `lastAccrualTimestamps02.length is ${getLoansAtLastAccrualForAfterWithdraw02[3].length} instead of ${expectNumEntries02}`
    );

    const totalTransferToAdapterForFarmer02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer02 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer02.eq(expectTotalTransferToAdapterForFarmer02),
      `totalTransferToAdapterForFarmer02 is ${totalTransferToAdapterForFarmer02} instead of ${expectTotalTransferToAdapterForFarmer02}`
    );
  });

  it("should return correct loan after single deposit and single full withdrawal by same user twice with different deposit amounts", async () => {
    const farmer = accounts[5];
    const depositAmount01 = ether("4587.969582306318327400");
    const depositAmount02 = ether("6355.924357907161867300");
    const secsBetweenDepositWithdraw = new BN("529987");
    const secsBetweenDeposits = new BN("43");

    const addLiquidity01 = await addLiquidityInFarmingPool(depositAmount01, farmer);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const withdrawAmount01 = addLiquidity01.receipt.logs[0].args.receiveQuantity;
    console.log(`addLiquidityTimestamp01=${addLiquidityTimestamp01}, withdrawAmount01=${withdrawAmount01}`);
    const expectAddLiquidityAccount01 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectAddLiquidityAmount01 = depositAmount01;
    const expectAddLiquidityTimestamp01 = addLiquidityTimestamp01;

    expectEvent(addLiquidity01, "AddLiquidity", {
      account: expectAddLiquidityAccount01,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress01,
      amount: expectAddLiquidityAmount01,
      timestamp: expectAddLiquidityTimestamp01,
    });

    await time.increase(secsBetweenDepositWithdraw);

    const farmingPoolUnderlyingAssetBalance01 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance01 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance01=${farmingPoolUnderlyingAssetBalance01}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw01: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw01[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw01[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw01[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw01[3][0]}`
    );

    const currentBlockNumber01 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp01 = await testUtil.getBlockTimestamp(currentBlockNumber01);
    console.log(`currentBlockTimestamp01=${currentBlockTimestamp01}`);
    const outstandingInterestTemp01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      currentBlockTimestamp01
    );
    const repaymentDetailsTemp01 = calculateRepaymentDetails(
      TAX_RATE,
      withdrawAmount01,
      withdrawAmount01.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterestTemp01
    );
    console.log(
      `repaymentDetailsTemp01: outstandingInterestTemp01=${outstandingInterestTemp01}, underlyingAssetInvested=${repaymentDetailsTemp01.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp01.taxAmount}, payableInterest=${repaymentDetailsTemp01.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp01.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp01.amountToReceive}`
    );

    const insuranceFundBeforeRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const removeLiquidity01 = await farmingPool.removeLiquidity(withdrawAmount01, { from: farmer });
    const removeLiquidityTimestamp01 = await testUtil.getBlockTimestamp(removeLiquidity01.receipt.blockHash);
    console.log(`removeLiquidityTimestamp01=${removeLiquidityTimestamp01}`);
    const insuranceFundAfterRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance01 = insuranceFundAfterRemove01.sub(insuranceFundBeforeRemove01);
    const totalUnderlyingAsset01 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      removeLiquidityTimestamp01
    );
    console.log(`outstandingInterest01=${outstandingInterest01}`);
    console.log(
      `RemoveLiquidityEvent01: requestedAmount=${removeLiquidity01.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity01.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity01.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity01.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity01.receipt.logs[0].args.timestamp}`
    );

    const expectRemoveLiquidityAccount01 = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectRemoveLiquidityRequestedAmount01 = withdrawAmount01;
    const expectRemoveLiquidityActualAmount01 = withdrawAmount01;
    const expectRemoveLiquidityTimestamp01 = removeLiquidityTimestamp01;

    expectEvent(removeLiquidity01, "RemoveLiquidity", {
      account: expectRemoveLiquidityAccount01,
      underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress01,
      requestedAmount: expectRemoveLiquidityRequestedAmount01,
      actualAmount: expectRemoveLiquidityActualAmount01,
      timestamp: expectRemoveLiquidityTimestamp01,
    });

    const outstandingInterest01Diff = testUtil.bnAbsDiff(
      removeLiquidity01.receipt.logs[0].args.outstandingInterest,
      outstandingInterest01
    );
    assert.ok(
      outstandingInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity01.outstandingInterest is ${removeLiquidity01.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest01}`
    );

    const getLoansAtLastAccrualForAfterWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails01 = calculateRepaymentDetails(
      TAX_RATE,
      removeLiquidity01.receipt.logs[0].args.actualAmount,
      removeLiquidity01.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterest01
    );
    console.log(
      `requestedAmount01=${removeLiquidity01.receipt.logs[0].args.requestedAmount}, actualAmount01=${removeLiquidity01.receipt.logs[0].args.actualAmount}, adapterTransfer01=${removeLiquidity01.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    console.log(
      `repaymentDetails01: underlyingAssetInvested=${repaymentDetails01.underlyingAssetInvested}, taxAmount=${repaymentDetails01.taxAmount}, payableInterest=${repaymentDetails01.payableInterest}, loanPrincipalToRepay=${repaymentDetails01.loanPrincipalToRepay}, amountToReceive=${repaymentDetails01.amountToReceive}`
    );

    assert.ok(
      removeLiquidity01.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails01.loanPrincipalToRepay),
      `EventRemoveLiquidity01.loanPrincipalToRepay is ${removeLiquidity01.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails01.loanPrincipalToRepay}`
    );
    const payableInterest01Diff = testUtil.bnAbsDiff(
      removeLiquidity01.receipt.logs[0].args.payableInterest,
      repaymentDetails01.payableInterest
    );
    assert.ok(
      payableInterest01Diff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `EventRemoveLiquidity01.payableInterest is ${removeLiquidity01.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails01.payableInterest}`
    );
    assert.ok(
      removeLiquidity01.receipt.logs[0].args.taxAmount.eq(repaymentDetails01.taxAmount),
      `EventRemoveLiquidity01.taxAmount is ${removeLiquidity01.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails01.taxAmount}`
    );
    const receiveQuantity01Diff = testUtil.bnAbsDiff(
      removeLiquidity01.receipt.logs[0].args.receiveQuantity,
      repaymentDetails01.amountToReceive
    );
    assert.ok(
      receiveQuantity01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity01.receiveQuantity is ${removeLiquidity01.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails01.amountToReceive}`
    );

    const expectTotalUnderlyingAsset01 = new BN("0");
    const expectNumEntries01 = 0;
    const expectInsuranceFundBalance01 = repaymentDetails01.taxAmount;

    assert.ok(
      insuranceFundBalance01.eq(expectInsuranceFundBalance01),
      `insuranceFundBalance01 is ${insuranceFundBalance01} instead of ${expectInsuranceFundBalance01}`
    );

    assert.ok(
      totalUnderlyingAsset01.eq(expectTotalUnderlyingAsset01),
      `totalUnderlyingAsset01 is ${totalUnderlyingAsset01} instead of ${expectTotalUnderlyingAsset01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[0].length,
      expectNumEntries01,
      `interestRates01.length is ${getLoansAtLastAccrualForAfterWithdraw01[0].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[1].length,
      expectNumEntries01,
      `principalsOnly01.length is ${getLoansAtLastAccrualForAfterWithdraw01[1].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[2].length,
      expectNumEntries01,
      `principalsWithInterest01.length is ${getLoansAtLastAccrualForAfterWithdraw01[2].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[3].length,
      expectNumEntries01,
      `lastAccrualTimestamps01.length is ${getLoansAtLastAccrualForAfterWithdraw01[3].length} instead of ${expectNumEntries01}`
    );

    const totalTransferToAdapterForFarmer01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer01 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer01.eq(expectTotalTransferToAdapterForFarmer01),
      `totalTransferToAdapterForFarmer01 is ${totalTransferToAdapterForFarmer01} instead of ${expectTotalTransferToAdapterForFarmer01}`
    );

    await time.increase(secsBetweenDeposits);

    const addLiquidity02 = await addLiquidityInFarmingPool(depositAmount02, farmer);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const withdrawAmount02 = addLiquidity02.receipt.logs[0].args.receiveQuantity;
    console.log(`addLiquidityTimestamp02=${addLiquidityTimestamp02}, withdrawAmount02=${withdrawAmount02}`);
    const expectAddLiquidityAccount02 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectAddLiquidityAmount02 = depositAmount02;
    const expectAddLiquidityTimestamp02 = addLiquidityTimestamp02;

    expectEvent(addLiquidity02, "AddLiquidity", {
      account: expectAddLiquidityAccount02,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress02,
      amount: expectAddLiquidityAmount02,
      timestamp: expectAddLiquidityTimestamp02,
    });

    await time.increase(secsBetweenDepositWithdraw);

    const farmingPoolUnderlyingAssetBalance02 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance02 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance02=${farmingPoolUnderlyingAssetBalance02}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw02: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw02[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw02[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw02[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw02[3][0]}`
    );

    const currentBlockNumber02 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp02 = await testUtil.getBlockTimestamp(currentBlockNumber02);
    console.log(`currentBlockTimestamp02=${currentBlockTimestamp02}`);
    const outstandingInterestTemp02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      currentBlockTimestamp02
    );
    const repaymentDetailsTemp02 = calculateRepaymentDetails(
      TAX_RATE,
      withdrawAmount02,
      withdrawAmount02.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterestTemp02
    );
    console.log(
      `repaymentDetailsTemp02: outstandingInterestTemp02=${outstandingInterestTemp02}, underlyingAssetInvested=${repaymentDetailsTemp02.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp02.taxAmount}, payableInterest=${repaymentDetailsTemp02.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp02.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp02.amountToReceive}`
    );

    const insuranceFundBeforeRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const removeLiquidity02 = await farmingPool.removeLiquidity(withdrawAmount02, { from: farmer });
    const removeLiquidityTimestamp02 = await testUtil.getBlockTimestamp(removeLiquidity02.receipt.blockHash);
    console.log(`removeLiquidityTimestamp02=${removeLiquidityTimestamp02}`);
    const insuranceFundAfterRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance02 = insuranceFundAfterRemove02.sub(insuranceFundBeforeRemove02);
    const totalUnderlyingAsset02 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      removeLiquidityTimestamp02
    );
    console.log(`outstandingInterest02=${outstandingInterest02}`);
    console.log(
      `RemoveLiquidityEvent02: requestedAmount=${removeLiquidity02.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity02.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity02.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity02.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity02.receipt.logs[0].args.timestamp}`
    );

    const expectRemoveLiquidityAccount02 = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectRemoveLiquidityRequestedAmount02 = withdrawAmount02;
    const expectRemoveLiquidityActualAmount02 = withdrawAmount02;
    const expectRemoveLiquidityTimestamp02 = removeLiquidityTimestamp02;

    expectEvent(removeLiquidity02, "RemoveLiquidity", {
      account: expectRemoveLiquidityAccount02,
      underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress02,
      requestedAmount: expectRemoveLiquidityRequestedAmount02,
      actualAmount: expectRemoveLiquidityActualAmount02,
      timestamp: expectRemoveLiquidityTimestamp02,
    });

    const outstandingInterest02Diff = testUtil.bnAbsDiff(
      removeLiquidity02.receipt.logs[0].args.outstandingInterest,
      outstandingInterest02
    );
    assert.ok(
      outstandingInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventRemoveLiquidity02.outstandingInterest is ${removeLiquidity02.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest02}`
    );

    const getLoansAtLastAccrualForAfterWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      removeLiquidity02.receipt.logs[0].args.actualAmount,
      removeLiquidity02.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterest02
    );
    console.log(
      `requestedAmount02=${removeLiquidity02.receipt.logs[0].args.requestedAmount}, actualAmount02=${removeLiquidity02.receipt.logs[0].args.actualAmount}, adapterTransfer02=${removeLiquidity02.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    console.log(
      `repaymentDetails02: underlyingAssetInvested=${repaymentDetails02.underlyingAssetInvested}, taxAmount=${repaymentDetails02.taxAmount}, payableInterest=${repaymentDetails02.payableInterest}, loanPrincipalToRepay=${repaymentDetails02.loanPrincipalToRepay}, amountToReceive=${repaymentDetails02.amountToReceive}`
    );

    assert.ok(
      removeLiquidity02.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails02.loanPrincipalToRepay),
      `EventRemoveLiquidity02.loanPrincipalToRepay is ${removeLiquidity02.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails02.loanPrincipalToRepay}`
    );
    const payableInterest02Diff = testUtil.bnAbsDiff(
      removeLiquidity02.receipt.logs[0].args.payableInterest,
      repaymentDetails02.payableInterest
    );
    assert.ok(
      payableInterest02Diff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `EventRemoveLiquidity02.payableInterest is ${removeLiquidity02.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails02.payableInterest}`
    );
    assert.ok(
      removeLiquidity02.receipt.logs[0].args.taxAmount.eq(repaymentDetails02.taxAmount),
      `EventRemoveLiquidity02.taxAmount is ${removeLiquidity02.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails02.taxAmount}`
    );
    const receiveQuantity02Diff = testUtil.bnAbsDiff(
      removeLiquidity02.receipt.logs[0].args.receiveQuantity,
      repaymentDetails02.amountToReceive
    );
    assert.ok(
      receiveQuantity02Diff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `EventRemoveLiquidity02.receiveQuantity is ${removeLiquidity02.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails02.amountToReceive}`
    );

    const expectTotalUnderlyingAsset02 = new BN("0");
    const expectNumEntries02 = 0;
    const expectInsuranceFundBalance02 = repaymentDetails02.taxAmount;

    assert.ok(
      insuranceFundBalance02.eq(expectInsuranceFundBalance02),
      `insuranceFundBalance02 is ${insuranceFundBalance02} instead of ${expectInsuranceFundBalance02}`
    );

    assert.ok(
      totalUnderlyingAsset02.eq(expectTotalUnderlyingAsset02),
      `totalUnderlyingAsset02 is ${totalUnderlyingAsset02} instead of ${expectTotalUnderlyingAsset02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[0].length,
      expectNumEntries02,
      `interestRates02.length is ${getLoansAtLastAccrualForAfterWithdraw02[0].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[1].length,
      expectNumEntries02,
      `principalsOnly02.length is ${getLoansAtLastAccrualForAfterWithdraw02[1].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[2].length,
      expectNumEntries02,
      `principalsWithInterest02.length is ${getLoansAtLastAccrualForAfterWithdraw02[2].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[3].length,
      expectNumEntries02,
      `lastAccrualTimestamps02.length is ${getLoansAtLastAccrualForAfterWithdraw02[3].length} instead of ${expectNumEntries02}`
    );

    const totalTransferToAdapterForFarmer02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer02 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer02.eq(expectTotalTransferToAdapterForFarmer02),
      `totalTransferToAdapterForFarmer02 is ${totalTransferToAdapterForFarmer02} instead of ${expectTotalTransferToAdapterForFarmer02}`
    );
  });

  it("should return correct loans for 3 deposits and 3 withdraws from same user at 3 different borrow interest rate", async () => {
    const farmer = accounts[5];

    const deposits = [
      {
        amount: ether("36000.000667406690496437"),
        expectNumEntries: 1,
        expectInterestRates: [new BN("10")],
        expectPrincipalsOnly: [ether("684000.012680727119432303")],
        expectPrincipalsWithInterest: [ether("684000.012680727119432303")],
        duration: new BN("251560"),
      },
      {
        amount: ether("14332.962786745559956904"),
        expectNumEntries: 2,
        expectInterestRates: [new BN("10"), new BN("16")],
        expectPrincipalsOnly: [ether("684000.012680727119432303"), ether("272326.292948165639181176")],
        expectPrincipalsWithInterest: [ether("684000.012680727119432303"), ether("272326.292948165639181176")],
        duration: new BN("639531"),
      },
      {
        amount: ether("10.431744908244091093"),
        expectNumEntries: 3,
        expectInterestRates: [new BN("10"), new BN("16"), new BN("34")],
        expectPrincipalsOnly: [
          ether("684000.012680727119432303"),
          ether("272326.292948165639181176"),
          ether("198.203153256637730767"),
        ],
        expectPrincipalsWithInterest: [
          ether("684000.012680727119432303"),
          ether("272326.292948165639181176"),
          ether("198.203153256637730767"),
        ],
        duration: new BN("320998"),
      },
    ];

    const withdraws = [
      {
        amount: ether("7476.811664721209815896"),
        expectNumEntries: 2,
        expectInterestRates: [new BN("10"), new BN("16")],
        expectPrincipalsOnly: [ether("684000.012680727119432303"), ether("265421.525019937127586841")],
        duration: new BN("227223"),
      },
      {
        amount: ether("283948.067375777212769317"),
        expectNumEntries: 1,
        expectInterestRates: [new BN("10")],
        expectPrincipalsOnly: [ether("679670.873693675894888293")],
        duration: new BN("463941"),
      },
      {
        amount: ether("0"),
        expectNumEntries: 0,
        expectInterestRates: [],
        expectPrincipalsOnly: [],
        duration: new BN("0"),
      },
    ];

    const expectAddLiquidityAccount = farmer;
    const expectAddLiquidityUnderlyingAssetAddress = underlyingAsset.address;

    let addLiquidityTimestamps = new Array(deposits.length).fill(0);
    let expectDepositTotalUnderlyingAsset = new BN("0");
    let expectDepositLastAccrualTimestamps = new Array(deposits.length).fill(0);
    let totalFarmerTransferToAdapter = new BN("0");

    for (let i = 0; i < deposits.length; i++) {
      const depositAmount = deposits[i].amount;
      const totalTreasuryPoolUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
      const totalTreasuryPoolLoanedUnderlyingAssetAmount = await treasuryPool.totalLoanedUnderlyingAssetAmount();
      const treasuryPoolUtilisationRate = await treasuryPool.getUtilisationRate();
      console.log(
        `Deposit ${i}: totalTreasuryPoolUnderlyingAssetAmount=${totalTreasuryPoolUnderlyingAssetAmount}, totalTreasuryPoolLoanedUnderlyingAssetAmount=${totalTreasuryPoolLoanedUnderlyingAssetAmount}, treasuryPoolUtilisationRate=${treasuryPoolUtilisationRate}`
      );
      const addLiquidity = await addLiquidityInFarmingPool(depositAmount, farmer);
      addLiquidityTimestamps[i] = await testUtil.getBlockTimestamp(addLiquidity.receipt.blockHash);
      const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();

      const expectAddLiquidityAmount = depositAmount;
      const expectAddLiquidityTimestamp = addLiquidityTimestamps[i];

      expectEvent(addLiquidity, "AddLiquidity", {
        account: expectAddLiquidityAccount,
        underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress,
        amount: expectAddLiquidityAmount,
        timestamp: expectAddLiquidityTimestamp,
      });

      totalFarmerTransferToAdapter = totalFarmerTransferToAdapter.add(
        addLiquidity.receipt.logs[0].args.receiveQuantity
      );
      console.log(
        `Deposit ${i}: totalFarmerTransferToAdapter: ${totalFarmerTransferToAdapter}, addLiquidityReceiveQuantity: ${addLiquidity.receipt.logs[0].args.receiveQuantity}`
      );

      const expectTotalFarmerTransferToAdapter = await farmingPool.getTotalTransferToAdapterFor(farmer);

      assert.ok(
        totalFarmerTransferToAdapter.eq(expectTotalFarmerTransferToAdapter),
        `Deposit ${i}: totalFarmerTransferToAdapter is ${totalFarmerTransferToAdapter} instead of ${expectTotalFarmerTransferToAdapter}`
      );

      const getLoansAtLastAccrualForAfterDeposit = await farmingPool.getLoansAtLastAccrualFor(farmer);
      const getPoolLoansAtLastAccrualAfterDeposit = await farmingPool.getPoolLoansAtLastAccrual();

      expectDepositTotalUnderlyingAsset = expectDepositTotalUnderlyingAsset.add(depositAmount);
      const expectDepositNumEntries = deposits[i].expectNumEntries;
      const expectDepositInterestRates = deposits[i].expectInterestRates;
      const expectDepositPrincipalsOnly = deposits[i].expectPrincipalsOnly;
      const expectDepositPrincipalsWithInterest = deposits[i].expectPrincipalsWithInterest;
      expectDepositLastAccrualTimestamps[i] = expectAddLiquidityTimestamp;

      assert.ok(
        totalUnderlyingAsset.eq(expectDepositTotalUnderlyingAsset),
        `Deposit ${i}: totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectDepositTotalUnderlyingAsset}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterDeposit[0].length,
        expectDepositNumEntries,
        `Deposit ${i}: interestRates.length is ${getLoansAtLastAccrualForAfterDeposit[0].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterDeposit[1].length,
        expectDepositNumEntries,
        `Deposit ${i}: principalsOnly.length is ${getLoansAtLastAccrualForAfterDeposit[1].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterDeposit[2].length,
        expectDepositNumEntries,
        `Deposit ${i}: principalsWithInterest.length is ${getLoansAtLastAccrualForAfterDeposit[2].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterDeposit[3].length,
        expectDepositNumEntries,
        `Deposit ${i}: lastAccrualTimestamps.length is ${getLoansAtLastAccrualForAfterDeposit[3].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterDeposit[0].length,
        expectDepositNumEntries,
        `Deposit ${i}: poolInterestRates.length is ${getPoolLoansAtLastAccrualAfterDeposit[0].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterDeposit[1].length,
        expectDepositNumEntries,
        `Deposit ${i}: poolPrincipalsOnly.length is ${getPoolLoansAtLastAccrualAfterDeposit[1].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterDeposit[2].length,
        expectDepositNumEntries,
        `Deposit ${i}: poolPrincipalsWithInterest.length is ${getPoolLoansAtLastAccrualAfterDeposit[2].length} instead of ${expectDepositNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterDeposit[3].length,
        expectDepositNumEntries,
        `Deposit ${i}: poolLastAccrualTimestamps.length is ${getPoolLoansAtLastAccrualAfterDeposit[3].length} instead of ${expectDepositNumEntries}`
      );

      for (let j = 0; j < expectDepositNumEntries; j++) {
        console.log(`Deposit ${i}, ${j}`);

        assert.ok(
          getLoansAtLastAccrualForAfterDeposit[0][j].eq(expectDepositInterestRates[j]),
          `Deposit ${i}, ${j}: interestRate[0] is ${getLoansAtLastAccrualForAfterDeposit[0][j]} instead of ${expectDepositInterestRates[j]}`
        );

        assert.ok(
          getLoansAtLastAccrualForAfterDeposit[1][j].eq(expectDepositPrincipalsOnly[j]),
          `Deposit ${i}, ${j}: principalOnly[1] is ${getLoansAtLastAccrualForAfterDeposit[1][j]} instead of ${expectDepositPrincipalsOnly[j]}`
        );

        assert.ok(
          getLoansAtLastAccrualForAfterDeposit[2][j].eq(expectDepositPrincipalsWithInterest[j]),
          `Deposit ${i}, ${j}: principalWithInterest[2] is ${getLoansAtLastAccrualForAfterDeposit[2][j]} instead of ${expectDepositPrincipalsWithInterest[j]}`
        );

        assert.ok(
          getLoansAtLastAccrualForAfterDeposit[3][j].eq(expectDepositLastAccrualTimestamps[j]),
          `Deposit ${i}, ${j}: lastAccrualTimestamp[3] is ${getLoansAtLastAccrualForAfterDeposit[3][j]} instead of ${expectDepositLastAccrualTimestamps[j]}`
        );

        assert.ok(
          getPoolLoansAtLastAccrualAfterDeposit[0][j].eq(expectDepositInterestRates[j]),
          `Deposit ${i}, ${j}: poolInterestRate[0] is ${getPoolLoansAtLastAccrualAfterDeposit[0][j]} instead of ${expectDepositInterestRates[j]}`
        );

        assert.ok(
          getPoolLoansAtLastAccrualAfterDeposit[1][j].eq(expectDepositPrincipalsOnly[j]),
          `Deposit ${i}, ${j}: poolPrincipalOnly[1] is ${getPoolLoansAtLastAccrualAfterDeposit[1][j]} instead of ${expectDepositPrincipalsOnly[j]}`
        );

        assert.ok(
          getPoolLoansAtLastAccrualAfterDeposit[2][j].eq(expectDepositPrincipalsWithInterest[j]),
          `Deposit ${i}, ${j}: poolPrincipalWithInterest[2] is ${getPoolLoansAtLastAccrualAfterDeposit[2][j]} instead of ${expectDepositPrincipalsWithInterest[j]}`
        );

        assert.ok(
          getPoolLoansAtLastAccrualAfterDeposit[3][j].eq(expectDepositLastAccrualTimestamps[j]),
          `Deposit ${i}, ${j}: poolLastAccrualTimestamp[3] is ${getPoolLoansAtLastAccrualAfterDeposit[3][j]} instead of ${expectDepositLastAccrualTimestamps[j]}`
        );
      }

      if (deposits[i].duration.gt(new BN("0"))) {
        await time.increase(deposits[i].duration);
      }
    }

    const expectRemoveLiquidityAccount = farmer;
    const expectRemoveLiquidityUnderlyingAssetAddress = underlyingAsset.address;

    let removeLiquidityTimestamps = new Array(withdraws.length).fill(0);
    let expectWithdrawTotalUnderlyingAsset = expectDepositTotalUnderlyingAsset;

    for (let i = 0; i < deposits.length; i++) {
      console.log(`expectDepositLastAccrualTimestamps[${i}]: ${expectDepositLastAccrualTimestamps[i]}`);
    }

    for (let i = 0; i < withdraws.length; i++) {
      const withdrawAmount = withdraws[i].amount.eq(new BN("0")) ? totalFarmerTransferToAdapter : withdraws[i].amount;
      const totalTransferToAdapter = await farmingPool.getTotalTransferToAdapterFor(farmer);
      const btokenBalance = await btoken.balanceOf(farmer);
      console.log(`Withdraw ${i}: totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}`);
      const getLoansAtLastAccrualForBeforeWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);
      const getPoolLoansAtLastAccrualBeforeWithdraw = await farmingPool.getPoolLoansAtLastAccrual();

      assert.strictEqual(
        getLoansAtLastAccrualForBeforeWithdraw[0].length,
        getPoolLoansAtLastAccrualBeforeWithdraw[0].length,
        `Withdraw ${i}: getLoansAtLastAccrualForBeforeWithdraw[0].length is ${getLoansAtLastAccrualForBeforeWithdraw[0].length} while getPoolLoansAtLastAccrualBeforeWithdraw[0].length is ${getPoolLoansAtLastAccrualBeforeWithdraw[0].length}`
      );

      for (let j = 0; j < getLoansAtLastAccrualForBeforeWithdraw[0].length; j++) {
        console.log(
          `Withdraw ${i}: getLoansAtLastAccrualForBeforeWithdraw: interestRate[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[0][j]}, principalOnly[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[1][j]}, principalWithInterest[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[2][j]}, timestamp[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[3][j]}`
        );
      }
      for (let j = 0; j < getPoolLoansAtLastAccrualBeforeWithdraw[0].length; j++) {
        console.log(
          `Withdraw ${i}: getPoolLoansAtLastAccrualBeforeWithdraw: interestRate[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[0][j]}, principalOnly[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[1][j]}, principalWithInterest[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[2][j]}, timestamp[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[3][j]}`
        );
      }

      const insuranceFundBeforeRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
      console.log(
        `Withdraw ${i}: withdrawAmount: ${withdrawAmount}, totalFarmerTransferToAdapter: ${totalFarmerTransferToAdapter}, totalTransferToAdapter: ${totalTransferToAdapter}`
      );
      const removeLiquidity = await farmingPool.removeLiquidity(withdrawAmount, { from: farmer });
      removeLiquidityTimestamps[i] = await testUtil.getBlockTimestamp(removeLiquidity.receipt.blockHash);
      console.log(`removeLiquidityTimestamps[${i}]: ${removeLiquidityTimestamps[i]}`);
      const insuranceFundAfterRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
      const insuranceFundBalance = insuranceFundAfterRemove.sub(insuranceFundBeforeRemove);
      const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();

      const expectRemoveLiquidityRequestedAmount = withdrawAmount;
      const expectRemoveLiquidityActualAmount = withdrawAmount;
      const expectRemoveLiquidityTimestamp = removeLiquidityTimestamps[i];

      const outstandingInterest = accrueInterestForLoans(
        getLoansAtLastAccrualForBeforeWithdraw,
        expectRemoveLiquidityTimestamp
      );
      accrueInterestForLoans(getPoolLoansAtLastAccrualBeforeWithdraw, expectRemoveLiquidityTimestamp);

      expectEvent(removeLiquidity, "RemoveLiquidity", {
        account: expectRemoveLiquidityAccount,
        underlyingAssetAddress: expectRemoveLiquidityUnderlyingAssetAddress,
        requestedAmount: expectRemoveLiquidityRequestedAmount,
        actualAmount: expectRemoveLiquidityActualAmount,
        timestamp: expectRemoveLiquidityTimestamp,
      });

      totalFarmerTransferToAdapter = totalFarmerTransferToAdapter.sub(expectRemoveLiquidityActualAmount);
      console.log(
        `Withdraw ${i}: totalFarmerTransferToAdapter: ${totalFarmerTransferToAdapter}, expectRemoveLiquidityActualAmount: ${expectRemoveLiquidityActualAmount}`
      );

      const expectTotalFarmerTransferToAdapter = await farmingPool.getTotalTransferToAdapterFor(farmer);

      assert.ok(
        totalFarmerTransferToAdapter.eq(expectTotalFarmerTransferToAdapter),
        `Withdraw ${i}: totalFarmerTransferToAdapter is ${totalFarmerTransferToAdapter} instead of ${expectTotalFarmerTransferToAdapter}`
      );

      const outstandingInterestDiff = testUtil.bnAbsDiff(
        removeLiquidity.receipt.logs[0].args.outstandingInterest,
        outstandingInterest
      );
      assert.ok(
        outstandingInterestDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
        `Withdraw ${i}: EventRemoveLiquidity.outstandingInterest is ${removeLiquidity.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest}`
      );

      const repaymentDetails = calculateRepaymentDetails(
        TAX_RATE,
        removeLiquidity.receipt.logs[0].args.actualAmount,
        removeLiquidity.receipt.logs[0].args.adapterTransfer,
        totalTransferToAdapter,
        btokenBalance,
        outstandingInterest
      );
      console.log(
        `Withdraw ${i}: RemoveLiquidityEvent: requestedAmount=${removeLiquidity.receipt.logs[0].args.requestedAmount}, actualAmount=${removeLiquidity.receipt.logs[0].args.actualAmount}, adapterTransfer=${removeLiquidity.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${removeLiquidity.receipt.logs[0].args.receiveQuantity}, timestamp=${removeLiquidity.receipt.logs[0].args.timestamp}`
      );
      const loanPrincipalToRepayDiff = testUtil.bnAbsDiff(
        removeLiquidity.receipt.logs[0].args.loanPrincipalToRepay,
        repaymentDetails.loanPrincipalToRepay
      );
      assert.ok(
        loanPrincipalToRepayDiff.lte(BN_ONE),
        `Withdraw ${i}: EventRemoveLiquidity.loanPrincipalToRepay is ${removeLiquidity.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails.loanPrincipalToRepay}`
      );

      const payableInterestDiff = testUtil.bnAbsDiff(
        removeLiquidity.receipt.logs[0].args.payableInterest,
        repaymentDetails.payableInterest
      );
      assert.ok(
        payableInterestDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
        `Withdraw ${i}: EventRemoveLiquidity.payableInterest is ${removeLiquidity.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails.payableInterest}`
      );

      assert.ok(
        removeLiquidity.receipt.logs[0].args.taxAmount.eq(repaymentDetails.taxAmount),
        `Withdraw ${i}: EventRemoveLiquidity.taxAmount is ${removeLiquidity.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails.taxAmount}`
      );

      const receiveQuantityDiff = testUtil.bnAbsDiff(
        removeLiquidity.receipt.logs[0].args.receiveQuantity,
        repaymentDetails.amountToReceive
      );
      assert.ok(
        receiveQuantityDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
        `Withdraw ${i}: EventRemoveLiquidity.receiveQuantity is ${removeLiquidity.receipt.logs[0].args.receiveQuantity} instead of ${repaymentDetails.amountToReceive}`
      );

      const getLoansAtLastAccrualForAfterWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);
      const getPoolLoansAtLastAccrualAfterWithdraw = await farmingPool.getPoolLoansAtLastAccrual();

      for (let j = 0; j < getLoansAtLastAccrualForAfterWithdraw[0].length; j++) {
        console.log(
          `Withdraw ${i}: getLoansAtLastAccrualForAfterWithdraw: interestRate[${j}]=${getLoansAtLastAccrualForAfterWithdraw[0][j]}, principalOnly[${j}]=${getLoansAtLastAccrualForAfterWithdraw[1][j]}, principalWithInterest[${j}]=${getLoansAtLastAccrualForAfterWithdraw[2][j]}, timestamp[${j}]=${getLoansAtLastAccrualForAfterWithdraw[3][j]}`
        );
      }

      expectWithdrawTotalUnderlyingAsset = expectWithdrawTotalUnderlyingAsset
        .mul(new BN(LEVERAGE_FACTOR))
        .sub(withdrawAmount)
        .div(new BN(LEVERAGE_FACTOR));
      const expectWithdrawNumEntries = withdraws[i].expectNumEntries;
      const expectWithdrawInterestRates = withdraws[i].expectInterestRates;
      const expectWithdrawPrincipalsOnly = withdraws[i].expectPrincipalsOnly;

      const withdrawTotalUnderlyingAssetDiff = testUtil.bnAbsDiff(
        totalUnderlyingAsset,
        expectWithdrawTotalUnderlyingAsset
      );
      assert.ok(
        withdrawTotalUnderlyingAssetDiff.lte(new BN("2")),
        `Withdraw ${i}: totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectWithdrawTotalUnderlyingAsset}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterWithdraw[0].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: interestRates.length is ${getLoansAtLastAccrualForAfterWithdraw[0].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterWithdraw[1].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: principalsOnly.length is ${getLoansAtLastAccrualForAfterWithdraw[1].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterWithdraw[2].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: principalsWithInterest.length is ${getLoansAtLastAccrualForAfterWithdraw[2].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getLoansAtLastAccrualForAfterWithdraw[3].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: lastAccrualTimestamps.length is ${getLoansAtLastAccrualForAfterWithdraw[3].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterWithdraw[0].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: poolInterestRates.length is ${getPoolLoansAtLastAccrualAfterWithdraw[0].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterWithdraw[1].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: poolPrincipalsOnly.length is ${getPoolLoansAtLastAccrualAfterWithdraw[1].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterWithdraw[2].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: poolPrincipalsWithInterest.length is ${getPoolLoansAtLastAccrualAfterWithdraw[2].length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        getPoolLoansAtLastAccrualAfterWithdraw[3].length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: poolLastAccrualTimestamps.length is ${getPoolLoansAtLastAccrualAfterWithdraw[3].length} instead of ${expectWithdrawNumEntries}`
      );

      for (let j = 0; j < getLoansAtLastAccrualForBeforeWithdraw[0].length; j++) {
        console.log(
          `Withdraw ${i} before repayPrincipalWithInterest: getLoansAtLastAccrualForBeforeWithdraw: interestRate[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[0][j]}, principalOnly[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[1][j]}, principalWithInterest[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[2][j]}, timestamp[${j}]=${getLoansAtLastAccrualForBeforeWithdraw[3][j]}`
        );
      }
      for (let j = 0; j < getPoolLoansAtLastAccrualBeforeWithdraw[0].length; j++) {
        console.log(
          `Withdraw ${i} before repayPrincipalWithInterest: getPoolLoansAtLastAccrualBeforeWithdraw: interestRate[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[0][j]}, principalOnly[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[1][j]}, principalWithInterest[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[2][j]}, timestamp[${j}]=${getPoolLoansAtLastAccrualBeforeWithdraw[3][j]}`
        );
      }

      const expectPrincipalsWithInterestRepaid = repayPrincipalWithInterest(
        getLoansAtLastAccrualForBeforeWithdraw[2],
        getPoolLoansAtLastAccrualBeforeWithdraw[2],
        repaymentDetails.loanPrincipalToRepay,
        repaymentDetails.payableInterest
      );

      for (let j = 0; j < expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer.length; j++) {
        console.log(
          `Withdraw ${i}, ${j}: expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer: ${expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer[j]}`
        );
      }
      for (let j = 0; j < expectPrincipalsWithInterestRepaid.principalsWithInterestForPool.length; j++) {
        console.log(
          `Withdraw ${i}, ${j}: expectPrincipalsWithInterestRepaid.principalsWithInterestForPool: ${expectPrincipalsWithInterestRepaid.principalsWithInterestForPool[j]}`
        );
      }

      assert.strictEqual(
        expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer.length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer.length is ${expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer.length} instead of ${expectWithdrawNumEntries}`
      );

      assert.strictEqual(
        expectPrincipalsWithInterestRepaid.principalsWithInterestForPool.length,
        expectWithdrawNumEntries,
        `Withdraw ${i}: expectPrincipalsWithInterestRepaid.principalsWithInterestForPool.length is ${expectPrincipalsWithInterestRepaid.principalsWithInterestForPool.length} instead of ${expectWithdrawNumEntries}`
      );

      const expectWithdrawLastAccrualTimestamp = removeLiquidityTimestamps[i];
      const principalWithInterestTolerance = new BN("50000000000000");

      for (let j = 0; j < expectWithdrawNumEntries; j++) {
        console.log(`Withdraw ${i}, ${j}`);

        assert.ok(
          getLoansAtLastAccrualForAfterWithdraw[0][j].eq(expectWithdrawInterestRates[j]),
          `Withdraw ${i}, ${j}: interestRate[0] is ${getLoansAtLastAccrualForAfterWithdraw[0][j]} instead of ${expectWithdrawInterestRates[j]}`
        );

        const withdrawPrincipalOnlyDiff = testUtil.bnAbsDiff(
          getLoansAtLastAccrualForAfterWithdraw[1][j],
          expectWithdrawPrincipalsOnly[j]
        );
        assert.ok(
          withdrawPrincipalOnlyDiff.lte(BN_ONE),
          `Withdraw ${i}, ${j}: principalOnly[1] is ${getLoansAtLastAccrualForAfterWithdraw[1][j]} instead of ${expectWithdrawPrincipalsOnly[j]}`
        );

        const principalWithInterestForFarmerDiff = testUtil.bnAbsDiff(
          getLoansAtLastAccrualForAfterWithdraw[2][j],
          expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer[j]
        );

        assert.ok(
          principalWithInterestForFarmerDiff.lte(principalWithInterestTolerance),
          `Withdraw ${i}, ${j}: principalWithInterest[2] is ${getLoansAtLastAccrualForAfterWithdraw[2][j]} instead of ${expectPrincipalsWithInterestRepaid.principalsWithInterestForFarmer[j]}`
        );

        assert.ok(
          getLoansAtLastAccrualForAfterWithdraw[3][j].eq(expectWithdrawLastAccrualTimestamp),
          `Withdraw ${i}, ${j}: lastAccrualTimestamp[3] is ${getLoansAtLastAccrualForAfterWithdraw[3][j]} instead of ${expectWithdrawLastAccrualTimestamp}`
        );

        assert.ok(
          getPoolLoansAtLastAccrualAfterWithdraw[0][j].eq(expectWithdrawInterestRates[j]),
          `Withdraw ${i}, ${j}: poolInterestRate[0] is ${getPoolLoansAtLastAccrualAfterWithdraw[0][j]} instead of ${expectWithdrawInterestRates[j]}`
        );

        const poolWithdrawPrincipalOnlyDiff = testUtil.bnAbsDiff(
          getPoolLoansAtLastAccrualAfterWithdraw[1][j],
          expectWithdrawPrincipalsOnly[j]
        );
        assert.ok(
          poolWithdrawPrincipalOnlyDiff.lte(BN_ONE),
          `Withdraw ${i}, ${j}: poolPrincipalOnly[1] is ${getPoolLoansAtLastAccrualAfterWithdraw[1][j]} instead of ${expectWithdrawPrincipalsOnly[j]}`
        );

        const principalWithInterestForPoolDiff = testUtil.bnAbsDiff(
          getPoolLoansAtLastAccrualAfterWithdraw[2][j],
          expectPrincipalsWithInterestRepaid.principalsWithInterestForPool[j]
        );

        assert.ok(
          principalWithInterestForPoolDiff.lte(principalWithInterestTolerance),
          `Withdraw ${i}, ${j}: poolPrincipalWithInterest[2] is ${getPoolLoansAtLastAccrualAfterWithdraw[2][j]} instead of ${expectPrincipalsWithInterestRepaid.principalsWithInterestForPool[j]}`
        );

        assert.ok(
          getPoolLoansAtLastAccrualAfterWithdraw[3][j].eq(expectWithdrawLastAccrualTimestamp),
          `Withdraw ${i}, ${j}: poolLastAccrualTimestamp[3] is ${getPoolLoansAtLastAccrualAfterWithdraw[3][j]} instead of ${expectWithdrawLastAccrualTimestamp}`
        );
      }

      if (withdraws[i].duration.gt(new BN("0"))) {
        await time.increase(withdraws[i].duration);
      }
    }

    const totalTransferToAdapterForFarmer = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer.eq(expectTotalTransferToAdapterForFarmer),
      `totalTransferToAdapterForFarmer is ${totalTransferToAdapterForFarmer} instead of ${expectTotalTransferToAdapterForFarmer}`
    );
  });

  it("should not allow removing of 0 liquidity", async () => {
    const farmer = accounts[5];

    await expectRevert(farmingPool.removeLiquidity(ether("0"), { from: farmer }), "0 requested amount");
  });

  it("should not allow removing of liquidity while paused", async () => {
    const farmer = accounts[5];

    await farmingPool.pause({ from: defaultGovernanceAccount });
    await expectRevert(farmingPool.removeLiquidity(ether("1"), { from: farmer }), "paused");
  });

  it("should not allow removing of liquidity if no liquidity added", async () => {
    const farmer = accounts[6];

    await expectRevert(farmingPool.removeLiquidity(ether("1"), { from: farmer }), "no transfer");
  });

  it("should not allow liquidation of zero account", async () => {
    await expectRevert(farmingPool.liquidate(ZERO_ADDRESS, { from: defaultGovernanceAccount }), "0 account");
  });

  it("should not allow liquidation of zero balance", async () => {
    const farmer = accounts[5];

    await expectRevert(farmingPool.liquidate(farmer, { from: defaultGovernanceAccount }), "insufficient BToken");
  });

  it("should return correct loan after single deposit and liquidate", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("9288.638117555329428930");
    const secsBetweenDepositLiquidate = new BN("704431");

    const addLiquidity = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp = await testUtil.getBlockTimestamp(addLiquidity.receipt.blockHash);

    const expectLiquidateAmount = addLiquidity.receipt.logs[0].args.receiveQuantity;
    console.log(`addLiquidityTimestamp=${addLiquidityTimestamp}, expectLiquidateAmount=${expectLiquidateAmount}`);
    const expectAddLiquidityAccount = farmer;
    const expectAddLiquidityUnderlyingAssetAddress = underlyingAsset.address;
    const expectAddLiquidityAmount = depositAmount;
    const expectAddLiquidityTimestamp = addLiquidityTimestamp;

    expectEvent(addLiquidity, "AddLiquidity", {
      account: expectAddLiquidityAccount,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress,
      amount: expectAddLiquidityAmount,
      timestamp: expectAddLiquidityTimestamp,
    });

    await time.increase(secsBetweenDepositLiquidate);

    const farmingPoolUnderlyingAssetBalance = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance=${farmingPoolUnderlyingAssetBalance}, totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw[3][0]}`
    );

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const currentBlockTimestamp = await testUtil.getBlockTimestamp(currentBlockNumber);
    console.log(`currentBlockTimestamp=${currentBlockTimestamp}`);
    const outstandingInterestTemp = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw,
      currentBlockTimestamp
    );
    const repaymentDetailsTemp = calculateRepaymentDetails(
      TAX_RATE,
      expectLiquidateAmount,
      expectLiquidateAmount.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter,
      btokenBalance,
      outstandingInterestTemp
    );
    console.log(
      `repaymentDetailsTemp: outstandingInterestTemp=${outstandingInterestTemp}, underlyingAssetInvested=${repaymentDetailsTemp.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp.taxAmount}, payableInterest=${repaymentDetailsTemp.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp.amountToReceive}`
    );

    const insuranceFundBeforeRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
    const liquidateFarmer = await farmingPool.liquidate(farmer, { from: defaultGovernanceAccount });
    const liquidateFarmerTimestamp = await testUtil.getBlockTimestamp(liquidateFarmer.receipt.blockHash);
    console.log(`liquidateFarmerTimestamp=${liquidateFarmerTimestamp}`);
    const insuranceFundAfterRemove = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance = insuranceFundAfterRemove.sub(insuranceFundBeforeRemove);
    const totalUnderlyingAsset = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw,
      liquidateFarmerTimestamp
    );
    console.log(`outstandingInterest=${outstandingInterest}`);
    console.log(
      `LiquidateFarmerEvent: requestedAmount=${liquidateFarmer.receipt.logs[0].args.requestedAmount}, actualAmount=${liquidateFarmer.receipt.logs[0].args.actualAmount}, adapterTransfer=${liquidateFarmer.receipt.logs[0].args.adapterTransfer}, loanPrincipalToRepay=${liquidateFarmer.receipt.logs[0].args.loanPrincipalToRepay}, payableInterest=${liquidateFarmer.receipt.logs[0].args.payableInterest}, taxAmount=${liquidateFarmer.receipt.logs[0].args.taxAmount}, liquidationPenalty=${liquidateFarmer.receipt.logs[0].args.liquidationPenalty}, receiveQuantity=${liquidateFarmer.receipt.logs[0].args.receiveQuantity}, timestamp=${liquidateFarmer.receipt.logs[0].args.timestamp}`
    );

    const expectLiquidateFarmerAccount = defaultGovernanceAccount;
    const expectLiquidateFarmerUnderlyingAssetAddress = underlyingAsset.address;
    const expectLiquidateFarmerFarmerAccount = farmer;
    const expectLiquidateFarmerRequestedAmount = expectLiquidateAmount;
    const expectLiquidateFarmerActualAmount = expectLiquidateAmount;
    const expectLiquidateFarmerTimestamp = liquidateFarmerTimestamp;

    expectEvent(liquidateFarmer, "LiquidateFarmer", {
      account: expectLiquidateFarmerAccount,
      underlyingAssetAddress: expectLiquidateFarmerUnderlyingAssetAddress,
      farmerAccount: expectLiquidateFarmerFarmerAccount,
      requestedAmount: expectLiquidateFarmerRequestedAmount,
      actualAmount: expectLiquidateFarmerActualAmount,
      timestamp: expectLiquidateFarmerTimestamp,
    });

    const outstandingInterestDiff = testUtil.bnAbsDiff(
      liquidateFarmer.receipt.logs[0].args.outstandingInterest,
      outstandingInterest
    );
    assert.ok(
      outstandingInterestDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer.outstandingInterest is ${liquidateFarmer.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest}`
    );

    const getLoansAtLastAccrualForAfterWithdraw = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      liquidateFarmer.receipt.logs[0].args.actualAmount,
      liquidateFarmer.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter,
      btokenBalance,
      outstandingInterest
    );
    const expectLiquidateFarmerPenalty = repaymentDetails.amountToReceive.mul(LIQUIDATION_PENALTY).div(PERCENT_100);
    const expectFinalAmountToReceive = repaymentDetails.amountToReceive.sub(expectLiquidateFarmerPenalty);

    console.log(
      `requestedAmount=${liquidateFarmer.receipt.logs[0].args.requestedAmount}, actualAmount=${liquidateFarmer.receipt.logs[0].args.actualAmount}, adapterTransfer=${liquidateFarmer.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter=${totalTransferToAdapter}, btokenBalance=${btokenBalance}`
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails.underlyingAssetInvested}, taxAmount=${repaymentDetails.taxAmount}, payableInterest=${repaymentDetails.payableInterest}, loanPrincipalToRepay=${repaymentDetails.loanPrincipalToRepay}, amountToReceive=${repaymentDetails.amountToReceive}`
    );

    assert.ok(
      liquidateFarmer.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails.loanPrincipalToRepay),
      `EventLiquidateFarmer.loanPrincipalToRepay is ${liquidateFarmer.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails.loanPrincipalToRepay}`
    );
    const payableInterestDiff = testUtil.bnAbsDiff(
      liquidateFarmer.receipt.logs[0].args.payableInterest,
      repaymentDetails.payableInterest
    );
    assert.ok(
      payableInterestDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer.payableInterest is ${liquidateFarmer.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails.payableInterest}`
    );
    assert.ok(
      liquidateFarmer.receipt.logs[0].args.taxAmount.eq(repaymentDetails.taxAmount),
      `EventLiquidateFarmer.taxAmount is ${liquidateFarmer.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails.taxAmount}`
    );
    const liquidateFarmerPenaltyDiff = testUtil.bnAbsDiff(
      liquidateFarmer.receipt.logs[0].args.liquidationPenalty,
      expectLiquidateFarmerPenalty
    );
    assert.ok(
      liquidateFarmerPenaltyDiff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer.liquidationPenalty is ${liquidateFarmer.receipt.logs[0].args.liquidationPenalty} instead of ${expectLiquidateFarmerPenalty}`
    );
    const finalAmountToReceiveDiff = testUtil.bnAbsDiff(
      liquidateFarmer.receipt.logs[0].args.receiveQuantity,
      expectFinalAmountToReceive
    );
    assert.ok(
      finalAmountToReceiveDiff.lte(BN_POINT_ZERO_CUBE_FIVE),
      `EventLiquidateFarmer.receiveQuantity is ${liquidateFarmer.receipt.logs[0].args.receiveQuantity} instead of ${expectFinalAmountToReceive}`
    );

    const expectTotalUnderlyingAsset = new BN("0");
    const expectNumEntries = 0;
    const expectInsuranceFundBalance = repaymentDetails.taxAmount.add(expectLiquidateFarmerPenalty);

    const insuranceFundBalanceDiff = testUtil.bnAbsDiff(insuranceFundBalance, expectInsuranceFundBalance);
    assert.ok(
      insuranceFundBalanceDiff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `insuranceFundBalance is ${insuranceFundBalance} instead of ${expectInsuranceFundBalance}`
    );

    assert.ok(
      totalUnderlyingAsset.eq(expectTotalUnderlyingAsset),
      `totalUnderlyingAsset is ${totalUnderlyingAsset} instead of ${expectTotalUnderlyingAsset}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[0].length,
      expectNumEntries,
      `interestRates.length is ${getLoansAtLastAccrualForAfterWithdraw[0].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[1].length,
      expectNumEntries,
      `principalsOnly.length is ${getLoansAtLastAccrualForAfterWithdraw[1].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[2].length,
      expectNumEntries,
      `principalsWithInterest.length is ${getLoansAtLastAccrualForAfterWithdraw[2].length} instead of ${expectNumEntries}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw[3].length,
      expectNumEntries,
      `lastAccrualTimestamps.length is ${getLoansAtLastAccrualForAfterWithdraw[3].length} instead of ${expectNumEntries}`
    );

    const totalTransferToAdapterForFarmer = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer.eq(expectTotalTransferToAdapterForFarmer),
      `totalTransferToAdapterForFarmer is ${totalTransferToAdapterForFarmer} instead of ${expectTotalTransferToAdapterForFarmer}`
    );
  });

  it("should return correct loan after single deposit and liquidate for same user twice", async () => {
    const farmer = accounts[5];
    const depositAmount = ether("25151.699427265733259000");
    const secsBetweenDepositLiquidate = new BN("370991");
    const secsBetweenDeposits = new BN("87");

    const addLiquidity01 = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const expectLiquidateAmount01 = addLiquidity01.receipt.logs[0].args.receiveQuantity;
    console.log(
      `addLiquidityTimestamp01=${addLiquidityTimestamp01}, expectLiquidateAmount01=${expectLiquidateAmount01}`
    );
    const expectAddLiquidityAccount01 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectAddLiquidityAmount01 = depositAmount;
    const expectAddLiquidityTimestamp01 = addLiquidityTimestamp01;

    expectEvent(addLiquidity01, "AddLiquidity", {
      account: expectAddLiquidityAccount01,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress01,
      amount: expectAddLiquidityAmount01,
      timestamp: expectAddLiquidityTimestamp01,
    });

    await time.increase(secsBetweenDepositLiquidate);

    const farmingPoolUnderlyingAssetBalance01 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance01 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance01=${farmingPoolUnderlyingAssetBalance01}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw01: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw01[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw01[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw01[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw01[3][0]}`
    );

    const currentBlockNumber01 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp01 = await testUtil.getBlockTimestamp(currentBlockNumber01);
    console.log(`currentBlockTimestamp01=${currentBlockTimestamp01}`);
    const outstandingInterestTemp01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      currentBlockTimestamp01
    );
    const repaymentDetailsTemp01 = calculateRepaymentDetails(
      TAX_RATE,
      expectLiquidateAmount01,
      expectLiquidateAmount01.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterestTemp01
    );
    console.log(
      `repaymentDetailsTemp01: outstandingInterestTemp01=${outstandingInterestTemp01}, underlyingAssetInvested=${repaymentDetailsTemp01.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp01.taxAmount}, payableInterest=${repaymentDetailsTemp01.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp01.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp01.amountToReceive}`
    );

    const insuranceFundBeforeRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const liquidateFarmer01 = await farmingPool.liquidate(farmer, { from: defaultGovernanceAccount });
    const liquidateFarmerTimestamp01 = await testUtil.getBlockTimestamp(liquidateFarmer01.receipt.blockHash);
    console.log(`liquidateFarmerTimestamp01=${liquidateFarmerTimestamp01}`);
    const insuranceFundAfterRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance01 = insuranceFundAfterRemove01.sub(insuranceFundBeforeRemove01);
    const totalUnderlyingAsset01 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      liquidateFarmerTimestamp01
    );
    console.log(`outstandingInterest01=${outstandingInterest01}`);
    console.log(
      `LiquidateFarmerEvent01: requestedAmount=${liquidateFarmer01.receipt.logs[0].args.requestedAmount}, actualAmount=${liquidateFarmer01.receipt.logs[0].args.actualAmount}, adapterTransfer=${liquidateFarmer01.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${liquidateFarmer01.receipt.logs[0].args.receiveQuantity}, timestamp=${liquidateFarmer01.receipt.logs[0].args.timestamp}`
    );

    const expectLiquidateFarmerAccount01 = defaultGovernanceAccount;
    const expectLiquidateFarmerUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectLiquidateFarmerFarmerAccount01 = farmer;
    const expectLiquidateFarmerRequestedAmount01 = expectLiquidateAmount01;
    const expectLiquidateFarmerActualAmount01 = expectLiquidateAmount01;
    const expectLiquidateFarmerTimestamp01 = liquidateFarmerTimestamp01;

    expectEvent(liquidateFarmer01, "LiquidateFarmer", {
      account: expectLiquidateFarmerAccount01,
      underlyingAssetAddress: expectLiquidateFarmerUnderlyingAssetAddress01,
      farmerAccount: expectLiquidateFarmerFarmerAccount01,
      requestedAmount: expectLiquidateFarmerRequestedAmount01,
      actualAmount: expectLiquidateFarmerActualAmount01,
      timestamp: expectLiquidateFarmerTimestamp01,
    });

    const outstandingInterest01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.outstandingInterest,
      outstandingInterest01
    );
    assert.ok(
      outstandingInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.outstandingInterest is ${liquidateFarmer01.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest01}`
    );

    const getLoansAtLastAccrualForAfterWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails01 = calculateRepaymentDetails(
      TAX_RATE,
      liquidateFarmer01.receipt.logs[0].args.actualAmount,
      liquidateFarmer01.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterest01
    );
    const expectLiquidateFarmerPenalty01 = repaymentDetails01.amountToReceive.mul(LIQUIDATION_PENALTY).div(PERCENT_100);
    const expectFinalAmountToReceive01 = repaymentDetails01.amountToReceive.sub(expectLiquidateFarmerPenalty01);

    console.log(
      `requestedAmount01=${liquidateFarmer01.receipt.logs[0].args.requestedAmount}, actualAmount01=${liquidateFarmer01.receipt.logs[0].args.actualAmount}, adapterTransfer01=${liquidateFarmer01.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    console.log(
      `repaymentDetails01: underlyingAssetInvested=${repaymentDetails01.underlyingAssetInvested}, taxAmount=${repaymentDetails01.taxAmount}, payableInterest=${repaymentDetails01.payableInterest}, loanPrincipalToRepay=${repaymentDetails01.loanPrincipalToRepay}, amountToReceive=${repaymentDetails01.amountToReceive}`
    );

    assert.ok(
      liquidateFarmer01.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails01.loanPrincipalToRepay),
      `EventLiquidateFarmer01.loanPrincipalToRepay is ${liquidateFarmer01.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails01.loanPrincipalToRepay}`
    );
    const payableInterest01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.payableInterest,
      repaymentDetails01.payableInterest
    );
    assert.ok(
      payableInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.payableInterest is ${liquidateFarmer01.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails01.payableInterest}`
    );
    assert.ok(
      liquidateFarmer01.receipt.logs[0].args.taxAmount.eq(repaymentDetails01.taxAmount),
      `EventLiquidateFarmer01.taxAmount is ${liquidateFarmer01.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails01.taxAmount}`
    );
    const liquidateFarmerPenalty01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.liquidationPenalty,
      expectLiquidateFarmerPenalty01
    );
    assert.ok(
      liquidateFarmerPenalty01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.liquidationPenalty is ${liquidateFarmer01.receipt.logs[0].args.liquidationPenalty} instead of ${expectLiquidateFarmerPenalty01}`
    );
    const finalAmountToReceive01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.receiveQuantity,
      expectFinalAmountToReceive01
    );
    assert.ok(
      finalAmountToReceive01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.receiveQuantity is ${liquidateFarmer01.receipt.logs[0].args.receiveQuantity} instead of ${expectFinalAmountToReceive01}`
    );

    const expectTotalUnderlyingAsset01 = new BN("0");
    const expectNumEntries01 = 0;
    const expectInsuranceFundBalance01 = repaymentDetails01.taxAmount.add(expectLiquidateFarmerPenalty01);

    const insuranceFundBalance01Diff = testUtil.bnAbsDiff(insuranceFundBalance01, expectInsuranceFundBalance01);
    assert.ok(
      insuranceFundBalance01Diff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `insuranceFundBalance01 is ${insuranceFundBalance01} instead of ${expectInsuranceFundBalance01}`
    );

    assert.ok(
      totalUnderlyingAsset01.eq(expectTotalUnderlyingAsset01),
      `totalUnderlyingAsset01 is ${totalUnderlyingAsset01} instead of ${expectTotalUnderlyingAsset01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[0].length,
      expectNumEntries01,
      `interestRates01.length is ${getLoansAtLastAccrualForAfterWithdraw01[0].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[1].length,
      expectNumEntries01,
      `principalsOnly01.length is ${getLoansAtLastAccrualForAfterWithdraw01[1].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[2].length,
      expectNumEntries01,
      `principalsWithInterest01.length is ${getLoansAtLastAccrualForAfterWithdraw01[2].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[3].length,
      expectNumEntries01,
      `lastAccrualTimestamps01.length is ${getLoansAtLastAccrualForAfterWithdraw01[3].length} instead of ${expectNumEntries01}`
    );

    const totalTransferToAdapterForFarmer01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer01 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer01.eq(expectTotalTransferToAdapterForFarmer01),
      `totalTransferToAdapterForFarmer01 is ${totalTransferToAdapterForFarmer01} instead of ${expectTotalTransferToAdapterForFarmer01}`
    );

    await time.increase(secsBetweenDeposits);

    const addLiquidity02 = await addLiquidityInFarmingPool(depositAmount, farmer);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const expectLiquidateAmount02 = addLiquidity02.receipt.logs[0].args.receiveQuantity;
    console.log(
      `addLiquidityTimestamp02=${addLiquidityTimestamp02}, expectLiquidateAmount02=${expectLiquidateAmount02}`
    );
    const expectAddLiquidityAccount02 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectAddLiquidityAmount02 = depositAmount;
    const expectAddLiquidityTimestamp02 = addLiquidityTimestamp02;

    expectEvent(addLiquidity02, "AddLiquidity", {
      account: expectAddLiquidityAccount02,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress02,
      amount: expectAddLiquidityAmount02,
      timestamp: expectAddLiquidityTimestamp02,
    });

    await time.increase(secsBetweenDepositLiquidate);

    const farmingPoolUnderlyingAssetBalance02 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance02 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance02=${farmingPoolUnderlyingAssetBalance02}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw02: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw02[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw02[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw02[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw02[3][0]}`
    );

    const currentBlockNumber02 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp02 = await testUtil.getBlockTimestamp(currentBlockNumber02);
    console.log(`currentBlockTimestamp02=${currentBlockTimestamp02}`);
    const outstandingInterestTemp02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      currentBlockTimestamp02
    );
    const repaymentDetailsTemp02 = calculateRepaymentDetails(
      TAX_RATE,
      expectLiquidateAmount02,
      expectLiquidateAmount02.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterestTemp02
    );
    console.log(
      `repaymentDetailsTemp02: outstandingInterestTemp02=${outstandingInterestTemp02}, underlyingAssetInvested=${repaymentDetailsTemp02.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp02.taxAmount}, payableInterest=${repaymentDetailsTemp02.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp02.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp02.amountToReceive}`
    );

    const insuranceFundBeforeRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const liquidateFarmer02 = await farmingPool.liquidate(farmer, { from: defaultGovernanceAccount });
    const liquidateFarmerTimestamp02 = await testUtil.getBlockTimestamp(liquidateFarmer02.receipt.blockHash);
    console.log(`liquidateFarmerTimestamp02=${liquidateFarmerTimestamp02}`);
    const insuranceFundAfterRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance02 = insuranceFundAfterRemove02.sub(insuranceFundBeforeRemove02);
    const totalUnderlyingAsset02 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      liquidateFarmerTimestamp02
    );
    console.log(`outstandingInterest02=${outstandingInterest02}`);
    console.log(
      `LiquidateFarmerEvent02: requestedAmount=${liquidateFarmer02.receipt.logs[0].args.requestedAmount}, actualAmount=${liquidateFarmer02.receipt.logs[0].args.actualAmount}, adapterTransfer=${liquidateFarmer02.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${liquidateFarmer02.receipt.logs[0].args.receiveQuantity}, timestamp=${liquidateFarmer02.receipt.logs[0].args.timestamp}`
    );

    const expectLiquidateFarmerAccount02 = defaultGovernanceAccount;
    const expectLiquidateFarmerUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectLiquidateFarmerFarmerAccount02 = farmer;
    const expectLiquidateFarmerRequestedAmount02 = expectLiquidateAmount02;
    const expectLiquidateFarmerActualAmount02 = expectLiquidateAmount02;
    const expectLiquidateFarmerTimestamp02 = liquidateFarmerTimestamp02;

    expectEvent(liquidateFarmer02, "LiquidateFarmer", {
      account: expectLiquidateFarmerAccount02,
      underlyingAssetAddress: expectLiquidateFarmerUnderlyingAssetAddress02,
      farmerAccount: expectLiquidateFarmerFarmerAccount02,
      requestedAmount: expectLiquidateFarmerRequestedAmount02,
      actualAmount: expectLiquidateFarmerActualAmount02,
      timestamp: expectLiquidateFarmerTimestamp02,
    });

    const outstandingInterest02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.outstandingInterest,
      outstandingInterest02
    );
    assert.ok(
      outstandingInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer02.outstandingInterest is ${liquidateFarmer02.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest02}`
    );

    const getLoansAtLastAccrualForAfterWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      liquidateFarmer02.receipt.logs[0].args.actualAmount,
      liquidateFarmer02.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterest02
    );
    const expectLiquidateFarmerPenalty02 = repaymentDetails02.amountToReceive.mul(LIQUIDATION_PENALTY).div(PERCENT_100);
    const expectFinalAmountToReceive02 = repaymentDetails02.amountToReceive.sub(expectLiquidateFarmerPenalty02);

    console.log(
      `requestedAmount02=${liquidateFarmer02.receipt.logs[0].args.requestedAmount}, actualAmount02=${liquidateFarmer02.receipt.logs[0].args.actualAmount}, adapterTransfer02=${liquidateFarmer02.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    console.log(
      `repaymentDetails02: underlyingAssetInvested=${repaymentDetails02.underlyingAssetInvested}, taxAmount=${repaymentDetails02.taxAmount}, payableInterest=${repaymentDetails02.payableInterest}, loanPrincipalToRepay=${repaymentDetails02.loanPrincipalToRepay}, amountToReceive=${repaymentDetails02.amountToReceive}`
    );

    assert.ok(
      liquidateFarmer02.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails02.loanPrincipalToRepay),
      `EventLiquidateFarmer02.loanPrincipalToRepay is ${liquidateFarmer02.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails02.loanPrincipalToRepay}`
    );
    const payableInterest02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.payableInterest,
      repaymentDetails02.payableInterest
    );
    assert.ok(
      payableInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer02.payableInterest is ${liquidateFarmer02.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails02.payableInterest}`
    );
    assert.ok(
      liquidateFarmer02.receipt.logs[0].args.taxAmount.eq(repaymentDetails02.taxAmount),
      `EventLiquidateFarmer02.taxAmount is ${liquidateFarmer02.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails02.taxAmount}`
    );
    const liquidateFarmerPenalty02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.liquidationPenalty,
      expectLiquidateFarmerPenalty02
    );
    assert.ok(
      liquidateFarmerPenalty02Diff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `EventLiquidateFarmer02.liquidationPenalty is ${liquidateFarmer02.receipt.logs[0].args.liquidationPenalty} instead of ${expectLiquidateFarmerPenalty02}`
    );
    const finalAmountToReceive02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.receiveQuantity,
      expectFinalAmountToReceive02
    );
    assert.ok(
      finalAmountToReceive02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer02.receiveQuantity is ${liquidateFarmer02.receipt.logs[0].args.receiveQuantity} instead of ${expectFinalAmountToReceive02}`
    );

    const expectTotalUnderlyingAsset02 = new BN("0");
    const expectNumEntries02 = 0;
    const expectInsuranceFundBalance02 = repaymentDetails02.taxAmount.add(expectLiquidateFarmerPenalty02);

    const insuranceFundBalance02Diff = testUtil.bnAbsDiff(insuranceFundBalance02, expectInsuranceFundBalance02);
    assert.ok(
      insuranceFundBalance02Diff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `insuranceFundBalance02 is ${insuranceFundBalance02} instead of ${expectInsuranceFundBalance02}`
    );

    assert.ok(
      totalUnderlyingAsset02.eq(expectTotalUnderlyingAsset02),
      `totalUnderlyingAsset02 is ${totalUnderlyingAsset02} instead of ${expectTotalUnderlyingAsset02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[0].length,
      expectNumEntries02,
      `interestRates02.length is ${getLoansAtLastAccrualForAfterWithdraw02[0].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[1].length,
      expectNumEntries02,
      `principalsOnly02.length is ${getLoansAtLastAccrualForAfterWithdraw02[1].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[2].length,
      expectNumEntries02,
      `principalsWithInterest02.length is ${getLoansAtLastAccrualForAfterWithdraw02[2].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[3].length,
      expectNumEntries02,
      `lastAccrualTimestamps02.length is ${getLoansAtLastAccrualForAfterWithdraw02[3].length} instead of ${expectNumEntries02}`
    );

    const totalTransferToAdapterForFarmer02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer02 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer02.eq(expectTotalTransferToAdapterForFarmer02),
      `totalTransferToAdapterForFarmer02 is ${totalTransferToAdapterForFarmer02} instead of ${expectTotalTransferToAdapterForFarmer02}`
    );
  });

  it("should return correct loan after single deposit and liquidate for same user twice with different deposit amounts", async () => {
    const farmer = accounts[5];
    const depositAmount01 = ether("8542.047225304901313000");
    const depositAmount02 = ether("5687.499093310344142200");
    const secsBetweenDepositLiquidate = new BN("693059");
    const secsBetweenDeposits = new BN("608");

    const addLiquidity01 = await addLiquidityInFarmingPool(depositAmount01, farmer);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const expectLiquidateAmount01 = addLiquidity01.receipt.logs[0].args.receiveQuantity;
    console.log(
      `addLiquidityTimestamp01=${addLiquidityTimestamp01}, expectLiquidateAmount01=${expectLiquidateAmount01}`
    );
    const expectAddLiquidityAccount01 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectAddLiquidityAmount01 = depositAmount01;
    const expectAddLiquidityTimestamp01 = addLiquidityTimestamp01;

    expectEvent(addLiquidity01, "AddLiquidity", {
      account: expectAddLiquidityAccount01,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress01,
      amount: expectAddLiquidityAmount01,
      timestamp: expectAddLiquidityTimestamp01,
    });

    await time.increase(secsBetweenDepositLiquidate);

    const farmingPoolUnderlyingAssetBalance01 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance01 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance01=${farmingPoolUnderlyingAssetBalance01}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw01: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw01[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw01[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw01[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw01[3][0]}`
    );

    const currentBlockNumber01 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp01 = await testUtil.getBlockTimestamp(currentBlockNumber01);
    console.log(`currentBlockTimestamp01=${currentBlockTimestamp01}`);
    const outstandingInterestTemp01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      currentBlockTimestamp01
    );
    const repaymentDetailsTemp01 = calculateRepaymentDetails(
      TAX_RATE,
      expectLiquidateAmount01,
      expectLiquidateAmount01.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterestTemp01
    );
    console.log(
      `repaymentDetailsTemp01: outstandingInterestTemp01=${outstandingInterestTemp01}, underlyingAssetInvested=${repaymentDetailsTemp01.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp01.taxAmount}, payableInterest=${repaymentDetailsTemp01.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp01.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp01.amountToReceive}`
    );

    const insuranceFundBeforeRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const liquidateFarmer01 = await farmingPool.liquidate(farmer, { from: defaultGovernanceAccount });
    const liquidateFarmerTimestamp01 = await testUtil.getBlockTimestamp(liquidateFarmer01.receipt.blockHash);
    console.log(`liquidateFarmerTimestamp01=${liquidateFarmerTimestamp01}`);
    const insuranceFundAfterRemove01 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance01 = insuranceFundAfterRemove01.sub(insuranceFundBeforeRemove01);
    const totalUnderlyingAsset01 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest01 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw01,
      liquidateFarmerTimestamp01
    );
    console.log(`outstandingInterest01=${outstandingInterest01}`);
    console.log(
      `LiquidateFarmerEvent01: requestedAmount=${liquidateFarmer01.receipt.logs[0].args.requestedAmount}, actualAmount=${liquidateFarmer01.receipt.logs[0].args.actualAmount}, adapterTransfer=${liquidateFarmer01.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${liquidateFarmer01.receipt.logs[0].args.receiveQuantity}, timestamp=${liquidateFarmer01.receipt.logs[0].args.timestamp}`
    );

    const expectLiquidateFarmerAccount01 = defaultGovernanceAccount;
    const expectLiquidateFarmerUnderlyingAssetAddress01 = underlyingAsset.address;
    const expectLiquidateFarmerFarmerAccount01 = farmer;
    const expectLiquidateFarmerRequestedAmount01 = expectLiquidateAmount01;
    const expectLiquidateFarmerActualAmount01 = expectLiquidateAmount01;
    const expectLiquidateFarmerTimestamp01 = liquidateFarmerTimestamp01;

    expectEvent(liquidateFarmer01, "LiquidateFarmer", {
      account: expectLiquidateFarmerAccount01,
      underlyingAssetAddress: expectLiquidateFarmerUnderlyingAssetAddress01,
      farmerAccount: expectLiquidateFarmerFarmerAccount01,
      requestedAmount: expectLiquidateFarmerRequestedAmount01,
      actualAmount: expectLiquidateFarmerActualAmount01,
      timestamp: expectLiquidateFarmerTimestamp01,
    });

    const outstandingInterest01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.outstandingInterest,
      outstandingInterest01
    );
    assert.ok(
      outstandingInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.outstandingInterest is ${liquidateFarmer01.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest01}`
    );

    const getLoansAtLastAccrualForAfterWithdraw01 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails01 = calculateRepaymentDetails(
      TAX_RATE,
      liquidateFarmer01.receipt.logs[0].args.actualAmount,
      liquidateFarmer01.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter01,
      btokenBalance01,
      outstandingInterest01
    );
    const expectLiquidateFarmerPenalty01 = repaymentDetails01.amountToReceive.mul(LIQUIDATION_PENALTY).div(PERCENT_100);
    const expectFinalAmountToReceive01 = repaymentDetails01.amountToReceive.sub(expectLiquidateFarmerPenalty01);

    console.log(
      `requestedAmount01=${liquidateFarmer01.receipt.logs[0].args.requestedAmount}, actualAmount01=${liquidateFarmer01.receipt.logs[0].args.actualAmount}, adapterTransfer01=${liquidateFarmer01.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter01=${totalTransferToAdapter01}, btokenBalance01=${btokenBalance01}`
    );
    console.log(
      `repaymentDetails01: underlyingAssetInvested=${repaymentDetails01.underlyingAssetInvested}, taxAmount=${repaymentDetails01.taxAmount}, payableInterest=${repaymentDetails01.payableInterest}, loanPrincipalToRepay=${repaymentDetails01.loanPrincipalToRepay}, amountToReceive=${repaymentDetails01.amountToReceive}`
    );

    assert.ok(
      liquidateFarmer01.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails01.loanPrincipalToRepay),
      `EventLiquidateFarmer01.loanPrincipalToRepay is ${liquidateFarmer01.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails01.loanPrincipalToRepay}`
    );
    const payableInterest01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.payableInterest,
      repaymentDetails01.payableInterest
    );
    assert.ok(
      payableInterest01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.payableInterest is ${liquidateFarmer01.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails01.payableInterest}`
    );
    assert.ok(
      liquidateFarmer01.receipt.logs[0].args.taxAmount.eq(repaymentDetails01.taxAmount),
      `EventLiquidateFarmer01.taxAmount is ${liquidateFarmer01.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails01.taxAmount}`
    );
    const liquidationPenalty01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.liquidationPenalty,
      expectLiquidateFarmerPenalty01
    );
    assert.ok(
      liquidationPenalty01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.liquidationPenalty is ${liquidateFarmer01.receipt.logs[0].args.liquidationPenalty} instead of ${expectLiquidateFarmerPenalty01}`
    );
    const finalAmountToReceive01Diff = testUtil.bnAbsDiff(
      liquidateFarmer01.receipt.logs[0].args.receiveQuantity,
      expectFinalAmountToReceive01
    );
    assert.ok(
      finalAmountToReceive01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer01.receiveQuantity is ${liquidateFarmer01.receipt.logs[0].args.receiveQuantity} instead of ${expectFinalAmountToReceive01}`
    );

    const expectTotalUnderlyingAsset01 = new BN("0");
    const expectNumEntries01 = 0;
    const expectInsuranceFundBalance01 = repaymentDetails01.taxAmount.add(expectLiquidateFarmerPenalty01);

    const insuranceFundBalance01Diff = testUtil.bnAbsDiff(insuranceFundBalance01, expectInsuranceFundBalance01);
    assert.ok(
      insuranceFundBalance01Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `insuranceFundBalance01 is ${insuranceFundBalance01} instead of ${expectInsuranceFundBalance01}`
    );

    assert.ok(
      totalUnderlyingAsset01.eq(expectTotalUnderlyingAsset01),
      `totalUnderlyingAsset01 is ${totalUnderlyingAsset01} instead of ${expectTotalUnderlyingAsset01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[0].length,
      expectNumEntries01,
      `interestRates01.length is ${getLoansAtLastAccrualForAfterWithdraw01[0].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[1].length,
      expectNumEntries01,
      `principalsOnly01.length is ${getLoansAtLastAccrualForAfterWithdraw01[1].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[2].length,
      expectNumEntries01,
      `principalsWithInterest01.length is ${getLoansAtLastAccrualForAfterWithdraw01[2].length} instead of ${expectNumEntries01}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw01[3].length,
      expectNumEntries01,
      `lastAccrualTimestamps01.length is ${getLoansAtLastAccrualForAfterWithdraw01[3].length} instead of ${expectNumEntries01}`
    );

    const totalTransferToAdapterForFarmer01 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer01 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer01.eq(expectTotalTransferToAdapterForFarmer01),
      `totalTransferToAdapterForFarmer01 is ${totalTransferToAdapterForFarmer01} instead of ${expectTotalTransferToAdapterForFarmer01}`
    );

    await time.increase(secsBetweenDeposits);

    const addLiquidity02 = await addLiquidityInFarmingPool(depositAmount02, farmer);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const expectLiquidateAmount02 = addLiquidity02.receipt.logs[0].args.receiveQuantity;
    console.log(
      `addLiquidityTimestamp02=${addLiquidityTimestamp02}, expectLiquidateAmount02=${expectLiquidateAmount02}`
    );
    const expectAddLiquidityAccount02 = farmer;
    const expectAddLiquidityUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectAddLiquidityAmount02 = depositAmount02;
    const expectAddLiquidityTimestamp02 = addLiquidityTimestamp02;

    expectEvent(addLiquidity02, "AddLiquidity", {
      account: expectAddLiquidityAccount02,
      underlyingAssetAddress: expectAddLiquidityUnderlyingAssetAddress02,
      amount: expectAddLiquidityAmount02,
      timestamp: expectAddLiquidityTimestamp02,
    });

    await time.increase(secsBetweenDepositLiquidate);

    const farmingPoolUnderlyingAssetBalance02 = await underlyingAsset.balanceOf(farmingPool.address);
    const totalTransferToAdapter02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const btokenBalance02 = await btoken.balanceOf(farmer);
    console.log(
      `farmingPoolUnderlyingAssetBalance02=${farmingPoolUnderlyingAssetBalance02}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    const getLoansAtLastAccrualForBeforeWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);
    console.log(
      `getLoansAtLastAccrualForBeforeWithdraw02: interestRate[0]=${getLoansAtLastAccrualForBeforeWithdraw02[0][0]}, principalOnly[0]=${getLoansAtLastAccrualForBeforeWithdraw02[1][0]}, principalWithInterest[0]=${getLoansAtLastAccrualForBeforeWithdraw02[2][0]}, timestamp[0]=${getLoansAtLastAccrualForBeforeWithdraw02[3][0]}`
    );

    const currentBlockNumber02 = await web3.eth.getBlockNumber();
    const currentBlockTimestamp02 = await testUtil.getBlockTimestamp(currentBlockNumber02);
    console.log(`currentBlockTimestamp02=${currentBlockTimestamp02}`);
    const outstandingInterestTemp02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      currentBlockTimestamp02
    );
    const repaymentDetailsTemp02 = calculateRepaymentDetails(
      TAX_RATE,
      expectLiquidateAmount02,
      expectLiquidateAmount02.mul(new BN("10025")).div(new BN("10000")),
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterestTemp02
    );
    console.log(
      `repaymentDetailsTemp02: outstandingInterestTemp02=${outstandingInterestTemp02}, underlyingAssetInvested=${repaymentDetailsTemp02.underlyingAssetInvested}, taxAmount=${repaymentDetailsTemp02.taxAmount}, payableInterest=${repaymentDetailsTemp02.payableInterest}, loanPrincipalToRepay=${repaymentDetailsTemp02.loanPrincipalToRepay}, amountToReceive=${repaymentDetailsTemp02.amountToReceive}`
    );

    const insuranceFundBeforeRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const liquidateFarmer02 = await farmingPool.liquidate(farmer, { from: defaultGovernanceAccount });
    const liquidateFarmerTimestamp02 = await testUtil.getBlockTimestamp(liquidateFarmer02.receipt.blockHash);
    console.log(`liquidateFarmerTimestamp02=${liquidateFarmerTimestamp02}`);
    const insuranceFundAfterRemove02 = await underlyingAsset.balanceOf(insuranceFundAddress);
    const insuranceFundBalance02 = insuranceFundAfterRemove02.sub(insuranceFundBeforeRemove02);
    const totalUnderlyingAsset02 = await farmingPool.totalUnderlyingAsset();
    const outstandingInterest02 = accrueInterestForLoans(
      getLoansAtLastAccrualForBeforeWithdraw02,
      liquidateFarmerTimestamp02
    );
    console.log(`outstandingInterest02=${outstandingInterest02}`);
    console.log(
      `LiquidateFarmerEvent02: requestedAmount=${liquidateFarmer02.receipt.logs[0].args.requestedAmount}, actualAmount=${liquidateFarmer02.receipt.logs[0].args.actualAmount}, adapterTransfer=${liquidateFarmer02.receipt.logs[0].args.adapterTransfer}, receiveQuantity=${liquidateFarmer02.receipt.logs[0].args.receiveQuantity}, timestamp=${liquidateFarmer02.receipt.logs[0].args.timestamp}`
    );

    const expectLiquidateFarmerAccount02 = defaultGovernanceAccount;
    const expectLiquidateFarmerUnderlyingAssetAddress02 = underlyingAsset.address;
    const expectLiquidateFarmerFarmerAccount02 = farmer;
    const expectLiquidateFarmerRequestedAmount02 = expectLiquidateAmount02;
    const expectLiquidateFarmerActualAmount02 = expectLiquidateAmount02;
    const expectLiquidateFarmerTimestamp02 = liquidateFarmerTimestamp02;

    expectEvent(liquidateFarmer02, "LiquidateFarmer", {
      account: expectLiquidateFarmerAccount02,
      underlyingAssetAddress: expectLiquidateFarmerUnderlyingAssetAddress02,
      farmerAccount: expectLiquidateFarmerFarmerAccount02,
      requestedAmount: expectLiquidateFarmerRequestedAmount02,
      actualAmount: expectLiquidateFarmerActualAmount02,
      timestamp: expectLiquidateFarmerTimestamp02,
    });

    const outstandingInterest02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.outstandingInterest,
      outstandingInterest02
    );
    assert.ok(
      outstandingInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer02.outstandingInterest is ${liquidateFarmer02.receipt.logs[0].args.outstandingInterest} instead of ${outstandingInterest02}`
    );

    const getLoansAtLastAccrualForAfterWithdraw02 = await farmingPool.getLoansAtLastAccrualFor(farmer);

    const repaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      liquidateFarmer02.receipt.logs[0].args.actualAmount,
      liquidateFarmer02.receipt.logs[0].args.adapterTransfer,
      totalTransferToAdapter02,
      btokenBalance02,
      outstandingInterest02
    );
    const expectLiquidateFarmerPenalty02 = repaymentDetails02.amountToReceive.mul(LIQUIDATION_PENALTY).div(PERCENT_100);
    const expectFinalAmountToReceive02 = repaymentDetails02.amountToReceive.sub(expectLiquidateFarmerPenalty02);

    console.log(
      `requestedAmount02=${liquidateFarmer02.receipt.logs[0].args.requestedAmount}, actualAmount02=${liquidateFarmer02.receipt.logs[0].args.actualAmount}, adapterTransfer02=${liquidateFarmer02.receipt.logs[0].args.adapterTransfer}, totalTransferToAdapter02=${totalTransferToAdapter02}, btokenBalance02=${btokenBalance02}`
    );
    console.log(
      `repaymentDetails02: underlyingAssetInvested=${repaymentDetails02.underlyingAssetInvested}, taxAmount=${repaymentDetails02.taxAmount}, payableInterest=${repaymentDetails02.payableInterest}, loanPrincipalToRepay=${repaymentDetails02.loanPrincipalToRepay}, amountToReceive=${repaymentDetails02.amountToReceive}`
    );

    assert.ok(
      liquidateFarmer02.receipt.logs[0].args.loanPrincipalToRepay.eq(repaymentDetails02.loanPrincipalToRepay),
      `EventLiquidateFarmer02.loanPrincipalToRepay is ${liquidateFarmer02.receipt.logs[0].args.loanPrincipalToRepay} instead of ${repaymentDetails02.loanPrincipalToRepay}`
    );
    const payableInterest02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.payableInterest,
      repaymentDetails02.payableInterest
    );
    assert.ok(
      payableInterest02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer02.payableInterest is ${liquidateFarmer02.receipt.logs[0].args.payableInterest} instead of ${repaymentDetails02.payableInterest}`
    );
    assert.ok(
      liquidateFarmer02.receipt.logs[0].args.taxAmount.eq(repaymentDetails02.taxAmount),
      `EventLiquidateFarmer02.taxAmount is ${liquidateFarmer02.receipt.logs[0].args.taxAmount} instead of ${repaymentDetails02.taxAmount}`
    );
    const liquidateFarmerPenalty02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.liquidationPenalty,
      expectLiquidateFarmerPenalty02
    );
    assert.ok(
      liquidateFarmerPenalty02Diff.lte(BN_POINT_ZERO_QUAD_FIVE),
      `EventLiquidateFarmer02.liquidationPenalty is ${liquidateFarmer02.receipt.logs[0].args.liquidationPenalty} instead of ${expectLiquidateFarmerPenalty02}`
    );
    const finalAmountToReceive02Diff = testUtil.bnAbsDiff(
      liquidateFarmer02.receipt.logs[0].args.receiveQuantity,
      expectFinalAmountToReceive02
    );
    assert.ok(
      finalAmountToReceive02Diff.lte(BN_POINT_ZERO_PENTA_FIVE),
      `EventLiquidateFarmer02.receiveQuantity is ${liquidateFarmer02.receipt.logs[0].args.receiveQuantity} instead of ${expectFinalAmountToReceive02}`
    );

    const expectTotalUnderlyingAsset02 = new BN("0");
    const expectNumEntries02 = 0;
    const expectInsuranceFundBalance02 = repaymentDetails02.taxAmount.add(expectLiquidateFarmerPenalty02);

    const insuranceFundBalance02Diff = testUtil.bnAbsDiff(insuranceFundBalance02, expectInsuranceFundBalance02);
    assert.ok(
      insuranceFundBalance02Diff.lte(BN_POINT_ZERO_HEXA_FIVE),
      `insuranceFundBalance02 is ${insuranceFundBalance02} instead of ${expectInsuranceFundBalance02}`
    );

    assert.ok(
      totalUnderlyingAsset02.eq(expectTotalUnderlyingAsset02),
      `totalUnderlyingAsset02 is ${totalUnderlyingAsset02} instead of ${expectTotalUnderlyingAsset02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[0].length,
      expectNumEntries02,
      `interestRates02.length is ${getLoansAtLastAccrualForAfterWithdraw02[0].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[1].length,
      expectNumEntries02,
      `principalsOnly02.length is ${getLoansAtLastAccrualForAfterWithdraw02[1].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[2].length,
      expectNumEntries02,
      `principalsWithInterest02.length is ${getLoansAtLastAccrualForAfterWithdraw02[2].length} instead of ${expectNumEntries02}`
    );

    assert.strictEqual(
      getLoansAtLastAccrualForAfterWithdraw02[3].length,
      expectNumEntries02,
      `lastAccrualTimestamps02.length is ${getLoansAtLastAccrualForAfterWithdraw02[3].length} instead of ${expectNumEntries02}`
    );

    const totalTransferToAdapterForFarmer02 = await farmingPool.getTotalTransferToAdapterFor(farmer);
    const expectTotalTransferToAdapterForFarmer02 = new BN("0");

    assert.ok(
      totalTransferToAdapterForFarmer02.eq(expectTotalTransferToAdapterForFarmer02),
      `totalTransferToAdapterForFarmer02 is ${totalTransferToAdapterForFarmer02} instead of ${expectTotalTransferToAdapterForFarmer02}`
    );
  });

  it("should not allow non-governance account to liquidate farmer", async () => {
    const nonGovernanceAccount = accounts[8];
    const farmer = accounts[5];

    await expectRevert(farmingPool.liquidate(farmer, { from: nonGovernanceAccount }), "unauthorized");
    await expectRevert(farmingPool.liquidate(farmer, { from: farmer }), "unauthorized");
  });

  it("should return correct repayment details for sufficient profit to cover interest and tax", async () => {
    const farmer = accounts[5];
    const expectDepositAmount = ether("8851.559504049689279100");
    const expectTransferToAdapter = expectDepositAmount.mul(new BN(LEVERAGE_FACTOR));
    const expectProfit = ether("691.710621244026425400");
    const expectTaxAmount = expectProfit.mul(TAX_RATE).div(PERCENT_100);
    const expectOutstandingInterest = ether("597.8163451298545164");
    const expectLoanPrincipalToRepay = expectTransferToAdapter.sub(expectDepositAmount);

    const addLiquidity = await addLiquidityInFarmingPool(expectDepositAmount, farmer);
    const btokenAmount = await btoken.balanceOf(farmer);
    const underlyingAssetQuantity = expectTransferToAdapter.add(expectProfit);

    const expectRepaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount,
      underlyingAssetQuantity,
      expectTransferToAdapter,
      btokenAmount,
      expectOutstandingInterest
    );
    console.log(
      `expectRepaymentDetails: underlyingAssetInvested=${expectRepaymentDetails.underlyingAssetInvested}, profit=${expectRepaymentDetails.profit}, taxAmount=${expectRepaymentDetails.taxAmount}, depositPrincipal=${expectRepaymentDetails.depositPrincipal}, payableInterest=${expectRepaymentDetails.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails.amountToReceive}`
    );

    const repaymentDetails = await farmingPool.calculateRepaymentDetails(
      farmer,
      btokenAmount,
      underlyingAssetQuantity,
      expectOutstandingInterest
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails[0]}, profit=${repaymentDetails[1]}, taxAmount=${repaymentDetails[2]}, depositPrincipal=${repaymentDetails[3]}, payableInterest=${repaymentDetails[4]}, loanPrincipalToRepay=${repaymentDetails[5]}, amountToReceive=${repaymentDetails[6]}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectTransferToAdapter),
      `underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectTransferToAdapter}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectRepaymentDetails.underlyingAssetInvested),
      `repaymentDetails.underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectRepaymentDetails.underlyingAssetInvested}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectProfit),
      `profit is ${repaymentDetails[1]} instead of ${expectProfit}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectRepaymentDetails.profit),
      `repaymentDetails.profit is ${repaymentDetails[1]} instead of ${expectRepaymentDetails.profit}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectTaxAmount),
      `taxAmount is ${repaymentDetails[2]} instead of ${expectTaxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectRepaymentDetails.taxAmount),
      `repaymentDetails.taxAmount is ${repaymentDetails[2]} instead of ${expectRepaymentDetails.taxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectDepositAmount),
      `depositPrincipal is ${repaymentDetails[3]} instead of ${expectDepositAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectRepaymentDetails.depositPrincipal),
      `repaymentDetails.depositPrincipal is ${repaymentDetails[3]} instead of ${expectRepaymentDetails.depositPrincipal}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectOutstandingInterest),
      `payableInterest is ${repaymentDetails[4]} instead of ${expectOutstandingInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectRepaymentDetails.payableInterest),
      `repaymentDetails.payableInterest is ${repaymentDetails[4]} instead of ${expectRepaymentDetails.payableInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectLoanPrincipalToRepay),
      `loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectLoanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectRepaymentDetails.loanPrincipalToRepay),
      `repaymentDetails.loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectRepaymentDetails.loanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[6]).eq(expectRepaymentDetails.amountToReceive),
      `amountToReceive is ${repaymentDetails[6]} instead of ${expectRepaymentDetails.amountToReceive}`
    );
  });

  it("should return correct repayment details for insufficient profit to cover interest and tax", async () => {
    const farmer = accounts[5];
    const expectDepositAmount = ether("34401.186448158349263000");
    const expectTransferToAdapter = expectDepositAmount.mul(new BN(LEVERAGE_FACTOR));
    const expectProfit = ether("958.266757954460450000");
    const expectTaxAmount = expectProfit.mul(TAX_RATE).div(PERCENT_100);
    const expectOutstandingInterest = ether("35247.714940613680927000");
    const expectLoanPrincipalToRepay = expectTransferToAdapter.sub(expectDepositAmount);

    const addLiquidity = await addLiquidityInFarmingPool(expectDepositAmount, farmer);
    const btokenAmount = await btoken.balanceOf(farmer);
    const underlyingAssetQuantity = expectTransferToAdapter.add(expectProfit);

    const expectRepaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount,
      underlyingAssetQuantity,
      expectTransferToAdapter,
      btokenAmount,
      expectOutstandingInterest
    );
    console.log(
      `expectRepaymentDetails: underlyingAssetInvested=${expectRepaymentDetails.underlyingAssetInvested}, profit=${expectRepaymentDetails.profit}, taxAmount=${expectRepaymentDetails.taxAmount}, depositPrincipal=${expectRepaymentDetails.depositPrincipal}, payableInterest=${expectRepaymentDetails.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails.amountToReceive}`
    );

    const repaymentDetails = await farmingPool.calculateRepaymentDetails(
      farmer,
      btokenAmount,
      underlyingAssetQuantity,
      expectOutstandingInterest
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails[0]}, profit=${repaymentDetails[1]}, taxAmount=${repaymentDetails[2]}, depositPrincipal=${repaymentDetails[3]}, payableInterest=${repaymentDetails[4]}, loanPrincipalToRepay=${repaymentDetails[5]}, amountToReceive=${repaymentDetails[6]}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectTransferToAdapter),
      `underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectTransferToAdapter}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectRepaymentDetails.underlyingAssetInvested),
      `repaymentDetails.underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectRepaymentDetails.underlyingAssetInvested}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectProfit),
      `profit is ${repaymentDetails[1]} instead of ${expectProfit}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectRepaymentDetails.profit),
      `repaymentDetails.profit is ${repaymentDetails[1]} instead of ${expectRepaymentDetails.profit}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectTaxAmount),
      `taxAmount is ${repaymentDetails[2]} instead of ${expectTaxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectRepaymentDetails.taxAmount),
      `repaymentDetails.taxAmount is ${repaymentDetails[2]} instead of ${expectRepaymentDetails.taxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectDepositAmount),
      `depositPrincipal is ${repaymentDetails[3]} instead of ${expectDepositAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectRepaymentDetails.depositPrincipal),
      `repaymentDetails.depositPrincipal is ${repaymentDetails[3]} instead of ${expectRepaymentDetails.depositPrincipal}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectOutstandingInterest),
      `payableInterest is ${repaymentDetails[4]} instead of ${expectOutstandingInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectRepaymentDetails.payableInterest),
      `repaymentDetails.payableInterest is ${repaymentDetails[4]} instead of ${expectRepaymentDetails.payableInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectLoanPrincipalToRepay),
      `loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectLoanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectRepaymentDetails.loanPrincipalToRepay),
      `repaymentDetails.loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectRepaymentDetails.loanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[6]).eq(expectRepaymentDetails.amountToReceive),
      `amountToReceive is ${repaymentDetails[6]} instead of ${expectRepaymentDetails.amountToReceive}`
    );
  });

  it("should revert for principal with profit insufficient to cover interest and tax", async () => {
    const farmer = accounts[5];
    const expectDepositAmount = ether("5567.338547748930514100");
    const expectTransferToAdapter = expectDepositAmount.mul(new BN(LEVERAGE_FACTOR));
    const expectProfit = ether("1.969450921494606800");
    const expectTaxAmount = expectProfit.mul(TAX_RATE).div(PERCENT_100);
    const expectOutstandingInterest = ether("5569.1110535782756603");
    const expectLoanPrincipalToRepay = expectTransferToAdapter.sub(expectDepositAmount);

    const addLiquidity = await addLiquidityInFarmingPool(expectDepositAmount, farmer);
    const btokenAmount = await btoken.balanceOf(farmer);
    const underlyingAssetQuantity = expectTransferToAdapter.add(expectProfit);

    const expectRepaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount,
      underlyingAssetQuantity,
      expectTransferToAdapter,
      btokenAmount,
      expectOutstandingInterest
    );
    console.log(
      `expectRepaymentDetails: underlyingAssetInvested=${expectRepaymentDetails.underlyingAssetInvested}, profit=${expectRepaymentDetails.profit}, taxAmount=${expectRepaymentDetails.taxAmount}, depositPrincipal=${expectRepaymentDetails.depositPrincipal}, payableInterest=${expectRepaymentDetails.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails.amountToReceive}`
    );

    await expectRevert(
      farmingPool.calculateRepaymentDetails(farmer, btokenAmount, underlyingAssetQuantity, expectOutstandingInterest),
      "SafeMath: subtraction overflow"
    );
  });

  it("should return correct repayment details for redemption with profit to just cover loan, interest and tax", async () => {
    const farmer = accounts[5];
    const expectDepositAmount = ether("14055.199926386547026000");
    const expectTransferToAdapter = expectDepositAmount.mul(new BN(LEVERAGE_FACTOR));
    const expectProfit = ether("8001.119377070075097000");
    const expectTaxAmount = expectProfit.mul(TAX_RATE).div(PERCENT_100);
    const expectOutstandingInterest = ether("21256.2073657496146133");
    const expectLoanPrincipalToRepay = expectTransferToAdapter.sub(expectDepositAmount);

    const addLiquidity = await addLiquidityInFarmingPool(expectDepositAmount, farmer);
    const btokenAmount = await btoken.balanceOf(farmer);
    const underlyingAssetQuantity = expectTransferToAdapter.add(expectProfit);

    const expectRepaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount,
      underlyingAssetQuantity,
      expectTransferToAdapter,
      btokenAmount,
      expectOutstandingInterest
    );
    console.log(
      `expectRepaymentDetails: underlyingAssetInvested=${expectRepaymentDetails.underlyingAssetInvested}, profit=${expectRepaymentDetails.profit}, taxAmount=${expectRepaymentDetails.taxAmount}, depositPrincipal=${expectRepaymentDetails.depositPrincipal}, payableInterest=${expectRepaymentDetails.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails.amountToReceive}`
    );

    const repaymentDetails = await farmingPool.calculateRepaymentDetails(
      farmer,
      btokenAmount,
      underlyingAssetQuantity,
      expectOutstandingInterest
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails[0]}, profit=${repaymentDetails[1]}, taxAmount=${repaymentDetails[2]}, depositPrincipal=${repaymentDetails[3]}, payableInterest=${repaymentDetails[4]}, loanPrincipalToRepay=${repaymentDetails[5]}, amountToReceive=${repaymentDetails[6]}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectTransferToAdapter),
      `underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectTransferToAdapter}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectRepaymentDetails.underlyingAssetInvested),
      `repaymentDetails.underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectRepaymentDetails.underlyingAssetInvested}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectProfit),
      `profit is ${repaymentDetails[1]} instead of ${expectProfit}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectRepaymentDetails.profit),
      `repaymentDetails.profit is ${repaymentDetails[1]} instead of ${expectRepaymentDetails.profit}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectTaxAmount),
      `taxAmount is ${repaymentDetails[2]} instead of ${expectTaxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectRepaymentDetails.taxAmount),
      `repaymentDetails.taxAmount is ${repaymentDetails[2]} instead of ${expectRepaymentDetails.taxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectDepositAmount),
      `depositPrincipal is ${repaymentDetails[3]} instead of ${expectDepositAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectRepaymentDetails.depositPrincipal),
      `repaymentDetails.depositPrincipal is ${repaymentDetails[3]} instead of ${expectRepaymentDetails.depositPrincipal}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectOutstandingInterest),
      `payableInterest is ${repaymentDetails[4]} instead of ${expectOutstandingInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectRepaymentDetails.payableInterest),
      `repaymentDetails.payableInterest is ${repaymentDetails[4]} instead of ${expectRepaymentDetails.payableInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectLoanPrincipalToRepay),
      `loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectLoanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectRepaymentDetails.loanPrincipalToRepay),
      `repaymentDetails.loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectRepaymentDetails.loanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[6]).eq(expectRepaymentDetails.amountToReceive),
      `amountToReceive is ${repaymentDetails[6]} instead of ${expectRepaymentDetails.amountToReceive}`
    );
  });

  it("should return correct repayment details for redemption without profit", async () => {
    const farmer = accounts[5];
    const expectDepositAmount = ether("34773.893310763484918000");
    const expectTransferToAdapter = expectDepositAmount.mul(new BN(LEVERAGE_FACTOR));
    const loss = ether("32357.400687121707350000");
    const expectProfit = ether("0");
    const expectTaxAmount = ether("0");
    const expectOutstandingInterest = ether("2108.208378798373812000");
    const expectLoanPrincipalToRepay = expectTransferToAdapter.sub(expectDepositAmount);

    const addLiquidity = await addLiquidityInFarmingPool(expectDepositAmount, farmer);
    const btokenAmount = await btoken.balanceOf(farmer);
    const underlyingAssetQuantity = expectTransferToAdapter.sub(loss);

    const expectRepaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount,
      underlyingAssetQuantity,
      expectTransferToAdapter,
      btokenAmount,
      expectOutstandingInterest
    );
    console.log(
      `expectRepaymentDetails: underlyingAssetInvested=${expectRepaymentDetails.underlyingAssetInvested}, profit=${expectRepaymentDetails.profit}, taxAmount=${expectRepaymentDetails.taxAmount}, depositPrincipal=${expectRepaymentDetails.depositPrincipal}, payableInterest=${expectRepaymentDetails.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails.amountToReceive}`
    );

    const repaymentDetails = await farmingPool.calculateRepaymentDetails(
      farmer,
      btokenAmount,
      underlyingAssetQuantity,
      expectOutstandingInterest
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails[0]}, profit=${repaymentDetails[1]}, taxAmount=${repaymentDetails[2]}, depositPrincipal=${repaymentDetails[3]}, payableInterest=${repaymentDetails[4]}, loanPrincipalToRepay=${repaymentDetails[5]}, amountToReceive=${repaymentDetails[6]}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectTransferToAdapter),
      `underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectTransferToAdapter}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectRepaymentDetails.underlyingAssetInvested),
      `repaymentDetails.underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectRepaymentDetails.underlyingAssetInvested}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectProfit),
      `profit is ${repaymentDetails[1]} instead of ${expectProfit}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectRepaymentDetails.profit),
      `repaymentDetails.profit is ${repaymentDetails[1]} instead of ${expectRepaymentDetails.profit}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectTaxAmount),
      `taxAmount is ${repaymentDetails[2]} instead of ${expectTaxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectRepaymentDetails.taxAmount),
      `repaymentDetails.taxAmount is ${repaymentDetails[2]} instead of ${expectRepaymentDetails.taxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectDepositAmount),
      `depositPrincipal is ${repaymentDetails[3]} instead of ${expectDepositAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectRepaymentDetails.depositPrincipal),
      `repaymentDetails.depositPrincipal is ${repaymentDetails[3]} instead of ${expectRepaymentDetails.depositPrincipal}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectOutstandingInterest),
      `payableInterest is ${repaymentDetails[4]} instead of ${expectOutstandingInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectRepaymentDetails.payableInterest),
      `repaymentDetails.payableInterest is ${repaymentDetails[4]} instead of ${expectRepaymentDetails.payableInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectLoanPrincipalToRepay),
      `loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectLoanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectRepaymentDetails.loanPrincipalToRepay),
      `repaymentDetails.loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectRepaymentDetails.loanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[6]).eq(expectRepaymentDetails.amountToReceive),
      `amountToReceive is ${repaymentDetails[6]} instead of ${expectRepaymentDetails.amountToReceive}`
    );
  });

  it("should return correct repayment details for redemption without profit to just cover loan, interest and tax", async () => {
    const farmer = accounts[5];
    const expectDepositAmount = ether("26531.208378798373812000");
    const expectTransferToAdapter = expectDepositAmount.mul(new BN(LEVERAGE_FACTOR));
    const loss = ether("25771.254480288954321000");
    const expectProfit = ether("0");
    const expectTaxAmount = ether("0");
    const expectOutstandingInterest = ether("759.953898509419491");
    const expectLoanPrincipalToRepay = expectTransferToAdapter.sub(expectDepositAmount);

    const addLiquidity = await addLiquidityInFarmingPool(expectDepositAmount, farmer);
    const btokenAmount = await btoken.balanceOf(farmer);
    const underlyingAssetQuantity = expectTransferToAdapter.sub(loss);

    const expectRepaymentDetails = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount,
      underlyingAssetQuantity,
      expectTransferToAdapter,
      btokenAmount,
      expectOutstandingInterest
    );
    console.log(
      `expectRepaymentDetails: underlyingAssetInvested=${expectRepaymentDetails.underlyingAssetInvested}, profit=${expectRepaymentDetails.profit}, taxAmount=${expectRepaymentDetails.taxAmount}, depositPrincipal=${expectRepaymentDetails.depositPrincipal}, payableInterest=${expectRepaymentDetails.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails.amountToReceive}`
    );

    const repaymentDetails = await farmingPool.calculateRepaymentDetails(
      farmer,
      btokenAmount,
      underlyingAssetQuantity,
      expectOutstandingInterest
    );
    console.log(
      `repaymentDetails: underlyingAssetInvested=${repaymentDetails[0]}, profit=${repaymentDetails[1]}, taxAmount=${repaymentDetails[2]}, depositPrincipal=${repaymentDetails[3]}, payableInterest=${repaymentDetails[4]}, loanPrincipalToRepay=${repaymentDetails[5]}, amountToReceive=${repaymentDetails[6]}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectTransferToAdapter),
      `underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectTransferToAdapter}`
    );

    assert.ok(
      new BN(repaymentDetails[0]).eq(expectRepaymentDetails.underlyingAssetInvested),
      `repaymentDetails.underlyingAssetInvested is ${repaymentDetails[0]} instead of ${expectRepaymentDetails.underlyingAssetInvested}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectProfit),
      `profit is ${repaymentDetails[1]} instead of ${expectProfit}`
    );

    assert.ok(
      new BN(repaymentDetails[1]).eq(expectRepaymentDetails.profit),
      `repaymentDetails.profit is ${repaymentDetails[1]} instead of ${expectRepaymentDetails.profit}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectTaxAmount),
      `taxAmount is ${repaymentDetails[2]} instead of ${expectTaxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[2]).eq(expectRepaymentDetails.taxAmount),
      `repaymentDetails.taxAmount is ${repaymentDetails[2]} instead of ${expectRepaymentDetails.taxAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectDepositAmount),
      `depositPrincipal is ${repaymentDetails[3]} instead of ${expectDepositAmount}`
    );

    assert.ok(
      new BN(repaymentDetails[3]).eq(expectRepaymentDetails.depositPrincipal),
      `repaymentDetails.depositPrincipal is ${repaymentDetails[3]} instead of ${expectRepaymentDetails.depositPrincipal}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectOutstandingInterest),
      `payableInterest is ${repaymentDetails[4]} instead of ${expectOutstandingInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[4]).eq(expectRepaymentDetails.payableInterest),
      `repaymentDetails.payableInterest is ${repaymentDetails[4]} instead of ${expectRepaymentDetails.payableInterest}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectLoanPrincipalToRepay),
      `loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectLoanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[5]).eq(expectRepaymentDetails.loanPrincipalToRepay),
      `repaymentDetails.loanPrincipalToRepay is ${repaymentDetails[5]} instead of ${expectRepaymentDetails.loanPrincipalToRepay}`
    );

    assert.ok(
      new BN(repaymentDetails[6]).eq(expectRepaymentDetails.amountToReceive),
      `amountToReceive is ${repaymentDetails[6]} instead of ${expectRepaymentDetails.amountToReceive}`
    );
  });

  it("should not allow need to liquidate for zero address", async () => {
    const liquidationThreshold = new BN("5");

    await expectRevert(farmingPool.needToLiquidate(ZERO_ADDRESS, liquidationThreshold), "zero account");
  });

  it("should not allow need to liquidate for zero balance", async () => {
    const farmer = accounts[5];
    const liquidationThreshold = new BN("5");

    await expectRevert(farmingPool.needToLiquidate(farmer, liquidationThreshold), "insufficient BToken");
  });

  it("should return need to liquidate for insufficient profit to cover interest and tax for borrow interest rate higher than yield rate by 10", async () => {
    const farmer01 = accounts[5];
    const farmer02 = accounts[6];
    const expectDepositAmount01 = ether("50000");
    const expectDepositAmount02 = ether("2.900866084040668000");
    const liquidationThreshold = new BN("5");
    const secondsAccrue = new BN("1209600");
    const expectTransferToAdapter01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectTransferToAdapter02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectTotalTransferToAdapter = expectTransferToAdapter01.add(expectTransferToAdapter02);
    console.log(
      `expectTransferToAdapter01=${expectTransferToAdapter01}, expectTransferToAdapter02=${expectTransferToAdapter02}, expectTotalTransferToAdapter=${expectTotalTransferToAdapter}`
    );
    const expectAdapterWrappedTokenAmount01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterWrappedTokenAmount02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterTotalWrappedToken = expectAdapterWrappedTokenAmount01.add(expectAdapterWrappedTokenAmount02);
    console.log(
      `expectAdapterWrappedTokenAmount01=${expectAdapterWrappedTokenAmount01}, expectAdapterWrappedTokenAmount02=${expectAdapterWrappedTokenAmount02}, expectAdapterTotalWrappedToken=${expectAdapterTotalWrappedToken}`
    );
    const expectLoanPrincipalToRepay02 = expectTransferToAdapter02.sub(expectDepositAmount02);

    const addLiquidity01 = await addLiquidityInFarmingPool(expectDepositAmount01, farmer01);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const utilisationRate02 = await treasuryPool.getUtilisationRate();
    const expectUtilisationRate02 = new BN("5f0000000000000000", 16);
    assert.ok(
      utilisationRate02.eq(expectUtilisationRate02),
      `utilisationRate02 is ${utilisationRate02} instead of ${expectUtilisationRate02}`
    );

    const borrowNominalAnnualRate02 = await farmingPool.getBorrowNominalAnnualRate(expectUtilisationRate02);
    const expectBorrowNominalAnnualRate02 = new BN("25");
    assert.ok(
      borrowNominalAnnualRate02.eq(expectBorrowNominalAnnualRate02),
      `borrowNominalAnnualRate02 is ${borrowNominalAnnualRate02} instead of ${expectBorrowNominalAnnualRate02}`
    );

    const addLiquidity02 = await addLiquidityInFarmingPool(expectDepositAmount02, farmer02);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const btokenAmount02 = await btoken.balanceOf(farmer02);
    console.log(`btokenAmount02=${btokenAmount02}`);

    await time.increase(secondsAccrue);

    const vaultNominalAnnualRate = await yearnVaultV2.NOMINAL_ANNUAL_RATE();
    const harvest = await yearnVaultV2.harvest();
    const harvestTimestamp = await testUtil.getBlockTimestamp(harvest.receipt.blockHash);
    const secondsVaultEarnInterest = harvestTimestamp.sub(addLiquidityTimestamp01);

    const adapterPrincipalWithInterest02 = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTransferToAdapter02,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterPrincipalWithInterest02=${adapterPrincipalWithInterest02}`
    );

    const adapterTotalPrincipalWithInterest = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTotalTransferToAdapter,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterTotalPrincipalWithInterest=${adapterTotalPrincipalWithInterest}`
    );
    const expectAdapterPrincipalWithInterest02 = btokenAmount02
      .mul(adapterTotalPrincipalWithInterest)
      .div(expectAdapterTotalWrappedToken);
    console.log(`expectAdapterPrincipalWithInterest02=${expectAdapterPrincipalWithInterest02}`);

    assert.ok(
      adapterPrincipalWithInterest02.eq(expectAdapterPrincipalWithInterest02),
      `adapterPrincipalWithInterest02 is ${adapterPrincipalWithInterest02} instead of ${expectAdapterPrincipalWithInterest02}`
    );

    const redeemableUnderlyingTokens02 = await yvdaiAdapter.getRedeemableUnderlyingTokensFor(btokenAmount02);
    console.log(`redeemableUnderlyingTokens02=${redeemableUnderlyingTokens02}`);

    const needToLiquidate02 = await farmingPool.needToLiquidate(farmer02, liquidationThreshold);
    const needToLiquidateBlockNumber02 = await web3.eth.getBlockNumber();
    const needToLiquidateTimestamp02 = await testUtil.getBlockTimestamp(needToLiquidateBlockNumber02);
    console.log(`needToLiquidateTimestamp02=${needToLiquidateTimestamp02}`);

    console.log(
      `IsLiquidate=${needToLiquidate02[0]}, accountRedeemableUnderlyingTokens=${needToLiquidate02[1]}, threshold=${needToLiquidate02[2]}`
    );

    assert.ok(
      needToLiquidate02[1].eq(redeemableUnderlyingTokens02),
      `redeemableUnderlyingTokens02 is ${needToLiquidate02[1]} instead of ${redeemableUnderlyingTokens02}`
    );

    const actualSecondsAccrue02 = needToLiquidateTimestamp02.sub(addLiquidityTimestamp02);
    const expectLoanPrincipalToRepayWithInterest02 = await farmingPool.accruePerSecondCompoundInterest(
      expectLoanPrincipalToRepay02,
      expectBorrowNominalAnnualRate02,
      actualSecondsAccrue02
    );
    const expectOutstandingInterest02 = expectLoanPrincipalToRepayWithInterest02.sub(expectLoanPrincipalToRepay02);
    console.log(
      `actualSecondsAccrue02=${actualSecondsAccrue02}, expectLoanPrincipalToRepayWithInterest02=${expectLoanPrincipalToRepayWithInterest02}, expectOutstandingInterest02=${expectOutstandingInterest02}`
    );

    const expectRepaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount02,
      redeemableUnderlyingTokens02,
      expectTransferToAdapter02,
      btokenAmount02,
      expectOutstandingInterest02
    );
    const expectThreshold02 = expectRepaymentDetails02.loanPrincipalToRepay
      .add(expectRepaymentDetails02.taxAmount)
      .add(expectRepaymentDetails02.payableInterest)
      .mul(liquidationThreshold.add(PERCENT_100))
      .div(PERCENT_100);
    console.log(
      `expectRepaymentDetails02: underlyingAssetInvested=${expectRepaymentDetails02.underlyingAssetInvested}, profit=${expectRepaymentDetails02.profit}, taxAmount=${expectRepaymentDetails02.taxAmount}, depositPrincipal=${expectRepaymentDetails02.depositPrincipal}, payableInterest=${expectRepaymentDetails02.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails02.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails02.amountToReceive}, expectThreshold02=${expectThreshold02}`
    );

    assert.ok(
      needToLiquidate02[2].eq(expectThreshold02),
      `threshold02 is ${needToLiquidate02[2]} instead of ${expectThreshold02}`
    );

    const expectIsLiquidate02 = true;
    console.log(`expectIsLiquidate02=${expectIsLiquidate02}`);
    assert.strictEqual(
      needToLiquidate02[0],
      expectIsLiquidate02,
      `IsLiquidate02 is ${needToLiquidate02[0]} instead of ${expectIsLiquidate02}`
    );
  });

  it("should return need to liquidate for insufficient profit to cover interest and tax for borrow interest rate higher than yield rate by 1", async () => {
    const farmer01 = accounts[5];
    const farmer02 = accounts[6];
    const expectDepositAmount01 = ether("36000");
    const expectDepositAmount02 = ether("69.781955270372973256");
    const liquidationThreshold = new BN("5");
    const secondsAccrue = new BN("3110400");
    const expectTransferToAdapter01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectTransferToAdapter02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectTotalTransferToAdapter = expectTransferToAdapter01.add(expectTransferToAdapter02);
    console.log(
      `expectTransferToAdapter01=${expectTransferToAdapter01}, expectTransferToAdapter02=${expectTransferToAdapter02}, expectTotalTransferToAdapter=${expectTotalTransferToAdapter}`
    );
    const expectAdapterWrappedTokenAmount01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterWrappedTokenAmount02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterTotalWrappedToken = expectAdapterWrappedTokenAmount01.add(expectAdapterWrappedTokenAmount02);
    console.log(
      `expectAdapterWrappedTokenAmount01=${expectAdapterWrappedTokenAmount01}, expectAdapterWrappedTokenAmount02=${expectAdapterWrappedTokenAmount02}, expectAdapterTotalWrappedToken=${expectAdapterTotalWrappedToken}`
    );
    const expectLoanPrincipalToRepay02 = expectTransferToAdapter02.sub(expectDepositAmount02);

    const addLiquidity01 = await addLiquidityInFarmingPool(expectDepositAmount01, farmer01);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const utilisationRate02 = await treasuryPool.getUtilisationRate();
    const expectUtilisationRate02 = new BN("446666666666666666", 16); // 68.4% in 64.64 fixed-point number
    assert.ok(
      utilisationRate02.eq(expectUtilisationRate02),
      `utilisationRate02 is ${utilisationRate02} instead of ${expectUtilisationRate02}`
    );

    const borrowNominalAnnualRate02 = await farmingPool.getBorrowNominalAnnualRate(expectUtilisationRate02);
    const expectBorrowNominalAnnualRate02 = new BN("16");
    assert.ok(
      borrowNominalAnnualRate02.eq(expectBorrowNominalAnnualRate02),
      `borrowNominalAnnualRate02 is ${borrowNominalAnnualRate02} instead of ${expectBorrowNominalAnnualRate02}`
    );

    const addLiquidity02 = await addLiquidityInFarmingPool(expectDepositAmount02, farmer02);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const btokenAmount02 = await btoken.balanceOf(farmer02);
    console.log(`btokenAmount02=${btokenAmount02}`);

    await time.increase(secondsAccrue);

    const vaultNominalAnnualRate = await yearnVaultV2.NOMINAL_ANNUAL_RATE();
    const harvest = await yearnVaultV2.harvest();
    const harvestTimestamp = await testUtil.getBlockTimestamp(harvest.receipt.blockHash);
    const secondsVaultEarnInterest = harvestTimestamp.sub(addLiquidityTimestamp01);

    const adapterPrincipalWithInterest02 = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTransferToAdapter02,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterPrincipalWithInterest02=${adapterPrincipalWithInterest02}`
    );

    const adapterTotalPrincipalWithInterest = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTotalTransferToAdapter,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterTotalPrincipalWithInterest=${adapterTotalPrincipalWithInterest}`
    );
    const expectAdapterPrincipalWithInterest02 = btokenAmount02
      .mul(adapterTotalPrincipalWithInterest)
      .div(expectAdapterTotalWrappedToken);
    console.log(`expectAdapterPrincipalWithInterest02=${expectAdapterPrincipalWithInterest02}`);

    assert.ok(
      adapterPrincipalWithInterest02.eq(expectAdapterPrincipalWithInterest02),
      `adapterPrincipalWithInterest02 is ${adapterPrincipalWithInterest02} instead of ${expectAdapterPrincipalWithInterest02}`
    );

    const redeemableUnderlyingTokens02 = await yvdaiAdapter.getRedeemableUnderlyingTokensFor(btokenAmount02);
    console.log(`redeemableUnderlyingTokens02=${redeemableUnderlyingTokens02}`);

    const needToLiquidate02 = await farmingPool.needToLiquidate(farmer02, liquidationThreshold);
    const needToLiquidateBlockNumber02 = await web3.eth.getBlockNumber();
    const needToLiquidateTimestamp02 = await testUtil.getBlockTimestamp(needToLiquidateBlockNumber02);
    console.log(`needToLiquidateTimestamp02=${needToLiquidateTimestamp02}`);

    console.log(
      `IsLiquidate=${needToLiquidate02[0]}, accountRedeemableUnderlyingTokens=${needToLiquidate02[1]}, threshold=${needToLiquidate02[2]}`
    );

    assert.ok(
      needToLiquidate02[1].eq(redeemableUnderlyingTokens02),
      `redeemableUnderlyingTokens02 is ${needToLiquidate02[1]} instead of ${redeemableUnderlyingTokens02}`
    );

    const actualSecondsAccrue02 = needToLiquidateTimestamp02.sub(addLiquidityTimestamp02);
    const expectLoanPrincipalToRepayWithInterest02 = await farmingPool.accruePerSecondCompoundInterest(
      expectLoanPrincipalToRepay02,
      expectBorrowNominalAnnualRate02,
      actualSecondsAccrue02
    );
    const expectOutstandingInterest02 = expectLoanPrincipalToRepayWithInterest02.sub(expectLoanPrincipalToRepay02);
    console.log(
      `actualSecondsAccrue02=${actualSecondsAccrue02}, expectLoanPrincipalToRepayWithInterest02=${expectLoanPrincipalToRepayWithInterest02}, expectOutstandingInterest02=${expectOutstandingInterest02}`
    );

    const expectRepaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount02,
      redeemableUnderlyingTokens02,
      expectTransferToAdapter02,
      btokenAmount02,
      expectOutstandingInterest02
    );
    const expectThreshold02 = expectRepaymentDetails02.loanPrincipalToRepay
      .add(expectRepaymentDetails02.taxAmount)
      .add(expectRepaymentDetails02.payableInterest)
      .mul(liquidationThreshold.add(PERCENT_100))
      .div(PERCENT_100);
    console.log(
      `expectRepaymentDetails02: underlyingAssetInvested=${expectRepaymentDetails02.underlyingAssetInvested}, profit=${expectRepaymentDetails02.profit}, taxAmount=${expectRepaymentDetails02.taxAmount}, depositPrincipal=${expectRepaymentDetails02.depositPrincipal}, payableInterest=${expectRepaymentDetails02.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails02.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails02.amountToReceive}, expectThreshold02=${expectThreshold02}`
    );

    assert.ok(
      needToLiquidate02[2].eq(expectThreshold02),
      `threshold02 is ${needToLiquidate02[2]} instead of ${expectThreshold02}`
    );

    const expectIsLiquidate02 = true;
    console.log(`expectIsLiquidate02=${expectIsLiquidate02}`);
    assert.strictEqual(
      needToLiquidate02[0],
      expectIsLiquidate02,
      `IsLiquidate02 is ${needToLiquidate02[0]} instead of ${expectIsLiquidate02}`
    );
  });

  it("should return no need to liquidate for sufficient profit to cover interest and tax for borrow interest rate higher than yield rate by 10", async () => {
    const farmer01 = accounts[5];
    const farmer02 = accounts[6];
    const expectDepositAmount01 = ether("50000");
    const expectDepositAmount02 = ether("22.438597742054417851");
    const liquidationThreshold = new BN("5");
    const secondsAccrue = new BN("604800");
    const expectTransferToAdapter01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectTransferToAdapter02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectTotalTransferToAdapter = expectTransferToAdapter01.add(expectTransferToAdapter02);
    console.log(
      `expectTransferToAdapter01=${expectTransferToAdapter01}, expectTransferToAdapter02=${expectTransferToAdapter02}, expectTotalTransferToAdapter=${expectTotalTransferToAdapter}`
    );
    const expectAdapterWrappedTokenAmount01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterWrappedTokenAmount02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterTotalWrappedToken = expectAdapterWrappedTokenAmount01.add(expectAdapterWrappedTokenAmount02);
    console.log(
      `expectAdapterWrappedTokenAmount01=${expectAdapterWrappedTokenAmount01}, expectAdapterWrappedTokenAmount02=${expectAdapterWrappedTokenAmount02}, expectAdapterTotalWrappedToken=${expectAdapterTotalWrappedToken}`
    );
    const expectLoanPrincipalToRepay02 = expectTransferToAdapter02.sub(expectDepositAmount02);

    const addLiquidity01 = await addLiquidityInFarmingPool(expectDepositAmount01, farmer01);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const utilisationRate02 = await treasuryPool.getUtilisationRate();
    const expectUtilisationRate02 = new BN("5f0000000000000000", 16);
    assert.ok(
      utilisationRate02.eq(expectUtilisationRate02),
      `utilisationRate02 is ${utilisationRate02} instead of ${expectUtilisationRate02}`
    );

    const borrowNominalAnnualRate02 = await farmingPool.getBorrowNominalAnnualRate(expectUtilisationRate02);
    const expectBorrowNominalAnnualRate02 = new BN("25");
    assert.ok(
      borrowNominalAnnualRate02.eq(expectBorrowNominalAnnualRate02),
      `borrowNominalAnnualRate02 is ${borrowNominalAnnualRate02} instead of ${expectBorrowNominalAnnualRate02}`
    );

    const addLiquidity02 = await addLiquidityInFarmingPool(expectDepositAmount02, farmer02);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const btokenAmount02 = await btoken.balanceOf(farmer02);
    console.log(`btokenAmount02=${btokenAmount02}`);

    await time.increase(secondsAccrue);

    const vaultNominalAnnualRate = await yearnVaultV2.NOMINAL_ANNUAL_RATE();
    const harvest = await yearnVaultV2.harvest();
    const harvestTimestamp = await testUtil.getBlockTimestamp(harvest.receipt.blockHash);
    const secondsVaultEarnInterest = harvestTimestamp.sub(addLiquidityTimestamp01);

    const adapterPrincipalWithInterest02 = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTransferToAdapter02,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterPrincipalWithInterest02=${adapterPrincipalWithInterest02}`
    );

    const adapterTotalPrincipalWithInterest = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTotalTransferToAdapter,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterTotalPrincipalWithInterest=${adapterTotalPrincipalWithInterest}`
    );
    const expectAdapterPrincipalWithInterest02 = btokenAmount02
      .mul(adapterTotalPrincipalWithInterest)
      .div(expectAdapterTotalWrappedToken);
    console.log(`expectAdapterPrincipalWithInterest02=${expectAdapterPrincipalWithInterest02}`);

    assert.ok(
      adapterPrincipalWithInterest02.eq(expectAdapterPrincipalWithInterest02),
      `adapterPrincipalWithInterest02 is ${adapterPrincipalWithInterest02} instead of ${expectAdapterPrincipalWithInterest02}`
    );

    const redeemableUnderlyingTokens02 = await yvdaiAdapter.getRedeemableUnderlyingTokensFor(btokenAmount02);
    console.log(`redeemableUnderlyingTokens02=${redeemableUnderlyingTokens02}`);

    const needToLiquidate02 = await farmingPool.needToLiquidate(farmer02, liquidationThreshold);
    const needToLiquidateBlockNumber02 = await web3.eth.getBlockNumber();
    const needToLiquidateTimestamp02 = await testUtil.getBlockTimestamp(needToLiquidateBlockNumber02);
    console.log(`needToLiquidateTimestamp02=${needToLiquidateTimestamp02}`);

    console.log(
      `IsLiquidate=${needToLiquidate02[0]}, accountRedeemableUnderlyingTokens=${needToLiquidate02[1]}, threshold=${needToLiquidate02[2]}`
    );

    assert.ok(
      needToLiquidate02[1].eq(redeemableUnderlyingTokens02),
      `redeemableUnderlyingTokens02 is ${needToLiquidate02[1]} instead of ${redeemableUnderlyingTokens02}`
    );

    const actualSecondsAccrue02 = needToLiquidateTimestamp02.sub(addLiquidityTimestamp02);
    const expectLoanPrincipalToRepayWithInterest02 = await farmingPool.accruePerSecondCompoundInterest(
      expectLoanPrincipalToRepay02,
      expectBorrowNominalAnnualRate02,
      actualSecondsAccrue02
    );
    const expectOutstandingInterest02 = expectLoanPrincipalToRepayWithInterest02.sub(expectLoanPrincipalToRepay02);
    console.log(
      `actualSecondsAccrue02=${actualSecondsAccrue02}, expectLoanPrincipalToRepayWithInterest02=${expectLoanPrincipalToRepayWithInterest02}, expectOutstandingInterest02=${expectOutstandingInterest02}`
    );

    const expectRepaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount02,
      redeemableUnderlyingTokens02,
      expectTransferToAdapter02,
      btokenAmount02,
      expectOutstandingInterest02
    );
    const expectThreshold02 = expectRepaymentDetails02.loanPrincipalToRepay
      .add(expectRepaymentDetails02.taxAmount)
      .add(expectRepaymentDetails02.payableInterest)
      .mul(liquidationThreshold.add(PERCENT_100))
      .div(PERCENT_100);
    console.log(
      `expectRepaymentDetails02: underlyingAssetInvested=${expectRepaymentDetails02.underlyingAssetInvested}, profit=${expectRepaymentDetails02.profit}, taxAmount=${expectRepaymentDetails02.taxAmount}, depositPrincipal=${expectRepaymentDetails02.depositPrincipal}, payableInterest=${expectRepaymentDetails02.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails02.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails02.amountToReceive}, expectThreshold02=${expectThreshold02}`
    );

    assert.ok(
      needToLiquidate02[2].eq(expectThreshold02),
      `threshold02 is ${needToLiquidate02[2]} instead of ${expectThreshold02}`
    );

    const expectIsLiquidate02 = false;
    console.log(`expectIsLiquidate02=${expectIsLiquidate02}`);
    assert.strictEqual(
      needToLiquidate02[0],
      expectIsLiquidate02,
      `IsLiquidate02 is ${needToLiquidate02[0]} instead of ${expectIsLiquidate02}`
    );
  });

  it("should return no need to liquidate for sufficient profit to cover interest and tax for borrow interest rate lower than yield rate by 2", async () => {
    const farmer01 = accounts[5];
    const farmer02 = accounts[6];
    const expectDepositAmount01 = ether("31105.263157894736842105");
    const expectDepositAmount02 = ether("45.535719335011303066");
    const liquidationThreshold = new BN("5");
    const secondsAccrue = new BN("31536000");
    const expectTransferToAdapter01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectTransferToAdapter02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectTotalTransferToAdapter = expectTransferToAdapter01.add(expectTransferToAdapter02);
    console.log(
      `expectTransferToAdapter01=${expectTransferToAdapter01}, expectTransferToAdapter02=${expectTransferToAdapter02}, expectTotalTransferToAdapter=${expectTotalTransferToAdapter}`
    );
    const expectAdapterWrappedTokenAmount01 = expectDepositAmount01.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterWrappedTokenAmount02 = expectDepositAmount02.mul(new BN(LEVERAGE_FACTOR));
    const expectAdapterTotalWrappedToken = expectAdapterWrappedTokenAmount01.add(expectAdapterWrappedTokenAmount02);
    console.log(
      `expectAdapterWrappedTokenAmount01=${expectAdapterWrappedTokenAmount01}, expectAdapterWrappedTokenAmount02=${expectAdapterWrappedTokenAmount02}, expectAdapterTotalWrappedToken=${expectAdapterTotalWrappedToken}`
    );
    const expectLoanPrincipalToRepay02 = expectTransferToAdapter02.sub(expectDepositAmount02);

    const addLiquidity01 = await addLiquidityInFarmingPool(expectDepositAmount01, farmer01);
    const addLiquidityTimestamp01 = await testUtil.getBlockTimestamp(addLiquidity01.receipt.blockHash);

    const utilisationRate02 = await treasuryPool.getUtilisationRate();
    const expectUtilisationRate02 = new BN("3b1999999999999999", 16); // 59.1% in 64.64 fixed-point number
    assert.ok(
      utilisationRate02.eq(expectUtilisationRate02),
      `utilisationRate02 is ${utilisationRate02} instead of ${expectUtilisationRate02}`
    );

    const borrowNominalAnnualRate02 = await farmingPool.getBorrowNominalAnnualRate(expectUtilisationRate02);
    const expectBorrowNominalAnnualRate02 = new BN("13");
    assert.ok(
      borrowNominalAnnualRate02.eq(expectBorrowNominalAnnualRate02),
      `borrowNominalAnnualRate02 is ${borrowNominalAnnualRate02} instead of ${expectBorrowNominalAnnualRate02}`
    );

    const addLiquidity02 = await addLiquidityInFarmingPool(expectDepositAmount02, farmer02);
    const addLiquidityTimestamp02 = await testUtil.getBlockTimestamp(addLiquidity02.receipt.blockHash);

    const btokenAmount02 = await btoken.balanceOf(farmer02);
    console.log(`btokenAmount02=${btokenAmount02}`);

    await time.increase(secondsAccrue);

    const vaultNominalAnnualRate = await yearnVaultV2.NOMINAL_ANNUAL_RATE();
    const harvest = await yearnVaultV2.harvest();
    const harvestTimestamp = await testUtil.getBlockTimestamp(harvest.receipt.blockHash);
    const secondsVaultEarnInterest = harvestTimestamp.sub(addLiquidityTimestamp01);

    const adapterPrincipalWithInterest02 = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTransferToAdapter02,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterPrincipalWithInterest02=${adapterPrincipalWithInterest02}`
    );

    const adapterTotalPrincipalWithInterest = await yearnVaultV2.accruePerSecondCompoundInterest(
      expectTotalTransferToAdapter,
      vaultNominalAnnualRate,
      secondsVaultEarnInterest
    );
    console.log(
      `secondsVaultEarnInterest=${secondsVaultEarnInterest}, adapterTotalPrincipalWithInterest=${adapterTotalPrincipalWithInterest}`
    );
    const expectAdapterPrincipalWithInterest02 = btokenAmount02
      .mul(adapterTotalPrincipalWithInterest)
      .div(expectAdapterTotalWrappedToken);
    console.log(`expectAdapterPrincipalWithInterest02=${expectAdapterPrincipalWithInterest02}`);

    assert.ok(
      adapterPrincipalWithInterest02.eq(expectAdapterPrincipalWithInterest02),
      `adapterPrincipalWithInterest02 is ${adapterPrincipalWithInterest02} instead of ${expectAdapterPrincipalWithInterest02}`
    );

    const redeemableUnderlyingTokens02 = await yvdaiAdapter.getRedeemableUnderlyingTokensFor(btokenAmount02);
    console.log(`redeemableUnderlyingTokens02=${redeemableUnderlyingTokens02}`);

    const needToLiquidate02 = await farmingPool.needToLiquidate(farmer02, liquidationThreshold);
    const needToLiquidateBlockNumber02 = await web3.eth.getBlockNumber();
    const needToLiquidateTimestamp02 = await testUtil.getBlockTimestamp(needToLiquidateBlockNumber02);
    console.log(`needToLiquidateTimestamp02=${needToLiquidateTimestamp02}`);

    console.log(
      `IsLiquidate=${needToLiquidate02[0]}, accountRedeemableUnderlyingTokens=${needToLiquidate02[1]}, threshold=${needToLiquidate02[2]}`
    );

    assert.ok(
      needToLiquidate02[1].eq(redeemableUnderlyingTokens02),
      `redeemableUnderlyingTokens02 is ${needToLiquidate02[1]} instead of ${redeemableUnderlyingTokens02}`
    );

    const actualSecondsAccrue02 = needToLiquidateTimestamp02.sub(addLiquidityTimestamp02);
    const expectLoanPrincipalToRepayWithInterest02 = await farmingPool.accruePerSecondCompoundInterest(
      expectLoanPrincipalToRepay02,
      expectBorrowNominalAnnualRate02,
      actualSecondsAccrue02
    );
    const expectOutstandingInterest02 = expectLoanPrincipalToRepayWithInterest02.sub(expectLoanPrincipalToRepay02);
    console.log(
      `actualSecondsAccrue02=${actualSecondsAccrue02}, expectLoanPrincipalToRepayWithInterest02=${expectLoanPrincipalToRepayWithInterest02}, expectOutstandingInterest02=${expectOutstandingInterest02}`
    );

    const expectRepaymentDetails02 = calculateRepaymentDetails(
      TAX_RATE,
      btokenAmount02,
      redeemableUnderlyingTokens02,
      expectTransferToAdapter02,
      btokenAmount02,
      expectOutstandingInterest02
    );
    const expectThreshold02 = expectRepaymentDetails02.loanPrincipalToRepay
      .add(expectRepaymentDetails02.taxAmount)
      .add(expectRepaymentDetails02.payableInterest)
      .mul(liquidationThreshold.add(PERCENT_100))
      .div(PERCENT_100);
    console.log(
      `expectRepaymentDetails02: underlyingAssetInvested=${expectRepaymentDetails02.underlyingAssetInvested}, profit=${expectRepaymentDetails02.profit}, taxAmount=${expectRepaymentDetails02.taxAmount}, depositPrincipal=${expectRepaymentDetails02.depositPrincipal}, payableInterest=${expectRepaymentDetails02.payableInterest}, loanPrincipalToRepay=${expectRepaymentDetails02.loanPrincipalToRepay}, amountToReceive=${expectRepaymentDetails02.amountToReceive}, expectThreshold02=${expectThreshold02}`
    );

    assert.ok(
      needToLiquidate02[2].eq(expectThreshold02),
      `threshold02 is ${needToLiquidate02[2]} instead of ${expectThreshold02}`
    );

    const expectIsLiquidate02 = false;
    console.log(`expectIsLiquidate02=${expectIsLiquidate02}`);
    assert.strictEqual(
      needToLiquidate02[0],
      expectIsLiquidate02,
      `IsLiquidate02 is ${needToLiquidate02[0]} instead of ${expectIsLiquidate02}`
    );
  });
});

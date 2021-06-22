const assert = require("assert");
const { expectRevert } = require("@openzeppelin/test-helpers");
const { ether, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

describe("Btoken", () => {
  let accounts;
  let defaultGovernanceAccount;
  let bdai;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    defaultGovernanceAccount = accounts[0];
  });

  beforeEach(async () => {
    bdai = await testUtil.newBtoken("BDai Token", "BDai");
  });

  it("should be initialized correctly", async () => {
    const name = await bdai.name();
    const symbol = await bdai.symbol();
    const decimals = await bdai.decimals();
    const initialTotalSupply = await bdai.totalSupply();
    const governanceAccount = await bdai.governanceAccount();

    const expectName = "BDai Token";
    const expectSymbol = "BDai";
    const expectDecimals = 18;
    const expectInitialTotalSupply = ether("0");
    const expectGovernanceAccount = defaultGovernanceAccount;

    assert.strictEqual(name, expectName, `Name is ${name} instead of ${expectName}`);
    assert.strictEqual(symbol, expectSymbol, `Symbol is ${symbol} instead of ${expectSymbol}`);
    assert.strictEqual(decimals.toNumber(), expectDecimals, `Decimals is ${decimals} instead of ${expectDecimals}`);
    assert.ok(
      initialTotalSupply.eq(expectInitialTotalSupply),
      `Initial total supply is ${initialTotalSupply} instead of ${expectInitialTotalSupply}`
    );
    assert.strictEqual(
      governanceAccount,
      expectGovernanceAccount,
      `Governance account is ${governanceAccount} instead of token creator ${expectGovernanceAccount}`
    );
  });

  it("should only allow governance account to change governance account", async () => {
    const nonGovernanceAccount = accounts[5];

    await expectRevert(
      bdai.setGovernanceAccount(nonGovernanceAccount, { from: nonGovernanceAccount }),
      "Btoken: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await bdai.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific governance account", async () => {
    const expectNewGovernanceAccount = accounts[5];

    await bdai.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await bdai.governanceAccount();

    await expectRevert(
      bdai.setGovernanceAccount(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "Btoken: new governance account is the zero address"
    );
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );
  });

  it("should only allow governance account to change farming pool address", async () => {
    const nonGovernanceAccount = accounts[5];
    const farmingPoolAddress = accounts[6];

    await expectRevert(
      bdai.setFarmingPoolAddress(farmingPoolAddress, { from: nonGovernanceAccount }),
      "Btoken: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await bdai.setFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific farming pool address", async () => {
    const expectNewFarmingPoolAddress = accounts[5];

    await bdai.setFarmingPoolAddress(expectNewFarmingPoolAddress, { from: defaultGovernanceAccount });
    const newFarmingPoolAddress = await bdai.farmingPoolAddress();

    await expectRevert(
      bdai.setFarmingPoolAddress(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "Btoken: new farming pool address is the zero address"
    );
    assert.strictEqual(
      newFarmingPoolAddress,
      expectNewFarmingPoolAddress,
      `New farming pool address is ${newFarmingPoolAddress} instead of ${expectNewFarmingPoolAddress}`
    );
  });

  it("should only allow farming pool to mint", async () => {
    const farmingPoolAddress = accounts[5];
    const nonFarmingPoolAddress = accounts[6];

    await bdai.setFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount });

    await expectRevert(
      bdai.mint(nonFarmingPoolAddress, ether("1"), { from: nonFarmingPoolAddress }),
      "Btoken: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await bdai.mint(nonFarmingPoolAddress, ether("1"), { from: farmingPoolAddress })
    );
  });

  it("should only allow farming pool to burn", async () => {
    const farmingPoolAddress = accounts[5];
    const nonFarmingPoolAddress = accounts[6];

    await bdai.setFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount });
    await bdai.mint(farmingPoolAddress, ether("1"), { from: farmingPoolAddress });
    await bdai.mint(nonFarmingPoolAddress, ether("1"), { from: farmingPoolAddress });

    const amountToBurn = ether("1");
    const beforeBalance = await bdai.balanceOf(nonFarmingPoolAddress);
    await bdai.burn(nonFarmingPoolAddress, amountToBurn, { from: farmingPoolAddress });
    const afterBalance = await bdai.balanceOf(nonFarmingPoolAddress);
    const expectedBurnedAmount = beforeBalance.sub(afterBalance);

    await expectRevert(
      bdai.burn(nonFarmingPoolAddress, amountToBurn, { from: nonFarmingPoolAddress }),
      "Btoken: sender not authorized"
    );
    await assert.ok(
      amountToBurn.eq(expectedBurnedAmount),
      `Burned amount is ${amountToBurn} instead of ${expectedBurnedAmount}`
    );
  });

  it("should be non-transferable", async () => {
    const farmingPoolAddress = accounts[5];
    const anotherAccount = accounts[6];

    await bdai.setFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount });
    await bdai.mint(farmingPoolAddress, ether("1"), { from: farmingPoolAddress });

    await expectRevert(
      bdai.transfer(anotherAccount, ether("1"), { from: farmingPoolAddress }),
      "Btoken: token is non-transferable"
    );
  });
});

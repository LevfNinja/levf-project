const assert = require("assert");
const { expectRevert } = require("@openzeppelin/test-helpers");
const { ether, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

describe("Ltoken", () => {
  let accounts;
  let defaultGovernanceAccount;
  let ldai;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    defaultGovernanceAccount = accounts[0];
  });

  beforeEach(async () => {
    ldai = await testUtil.newErc20Ltoken("LDai Token", "LDai");
  });

  it("should be initialized correctly", async () => {
    const name = await ldai.name();
    const symbol = await ldai.symbol();
    const decimals = await ldai.decimals();
    const initialTotalSupply = await ldai.totalSupply();
    const governanceAccount = await ldai.governanceAccount();

    const expectName = "LDai Token";
    const expectSymbol = "LDai";
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
      ldai.setGovernanceAccount(nonGovernanceAccount, { from: nonGovernanceAccount }),
      "Erc20Ltoken: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await ldai.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific governance account", async () => {
    const expectNewGovernanceAccount = accounts[5];

    await ldai.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await ldai.governanceAccount();

    await expectRevert(
      ldai.setGovernanceAccount(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "Erc20Ltoken: new governance account is the zero address"
    );
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );
  });

  it("should only allow governance account to change treasury pool", async () => {
    const nonGovernanceAccount = accounts[5];
    const treasuryPoolAddress = accounts[6];

    await expectRevert(
      ldai.setTreasuryPoolAddress(treasuryPoolAddress, { from: nonGovernanceAccount }),
      "Erc20Ltoken: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await ldai.setTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific treasury pool", async () => {
    const expectNewTreasuryPoolAddress = accounts[5];

    await ldai.setTreasuryPoolAddress(expectNewTreasuryPoolAddress, { from: defaultGovernanceAccount });
    const treasuryPoolAddress = await ldai.treasuryPoolAddress();

    await expectRevert(
      ldai.setTreasuryPoolAddress(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "Erc20Ltoken: new treasury pool address is the zero address"
    );
    assert.strictEqual(
      treasuryPoolAddress,
      expectNewTreasuryPoolAddress,
      `New treasury pool address is ${treasuryPoolAddress} instead of ${expectNewTreasuryPoolAddress}`
    );
  });

  it("should only allow treasury pool to mint", async () => {
    const treasuryPoolAddress = accounts[5];
    const nonTreasuryPoolAddress = accounts[6];

    await ldai.setTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });

    await expectRevert(
      ldai.mint(nonTreasuryPoolAddress, ether("1"), { from: nonTreasuryPoolAddress }),
      "Erc20Ltoken: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await ldai.mint(nonTreasuryPoolAddress, ether("1"), { from: treasuryPoolAddress })
    );
  });

  it("should only allow treasury pool to burn", async () => {
    const treasuryPoolAddress = accounts[5];
    const nonTreasuryPoolAddress = accounts[6];

    await ldai.setTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });
    await ldai.mint(treasuryPoolAddress, ether("1"), { from: treasuryPoolAddress });
    await ldai.mint(nonTreasuryPoolAddress, ether("1"), { from: treasuryPoolAddress });

    const amountToBurn = ether("1");
    const beforeBalance = await ldai.balanceOf(nonTreasuryPoolAddress);
    await ldai.burn(nonTreasuryPoolAddress, amountToBurn, { from: treasuryPoolAddress });
    const afterBalance = await ldai.balanceOf(nonTreasuryPoolAddress);
    const expectedBurnedAmount = beforeBalance.sub(afterBalance);

    await expectRevert(
      ldai.burn(nonTreasuryPoolAddress, amountToBurn, { from: nonTreasuryPoolAddress }),
      "Erc20Ltoken: sender not authorized"
    );
    await assert.ok(
      amountToBurn.eq(expectedBurnedAmount),
      `Burned amount is ${amountToBurn} instead of ${expectedBurnedAmount}`
    );
  });

  it("should be non-transferable", async () => {
    const treasuryPoolAddress = accounts[5];
    const anotherTreasuryPoolAddress = accounts[6];

    await ldai.setTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });
    await ldai.mint(treasuryPoolAddress, ether("1"), { from: treasuryPoolAddress });

    await expectRevert(
      ldai.transfer(anotherTreasuryPoolAddress, ether("1"), { from: treasuryPoolAddress }),
      "Erc20Ltoken: token is non-transferable"
    );
  });
});

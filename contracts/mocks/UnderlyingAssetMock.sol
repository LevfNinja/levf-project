// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract UnderlyingAssetMock is ERC20 {
    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {} // solhint-disable-line no-empty-blocks

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

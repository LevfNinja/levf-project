// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./interfaces/ILtoken.sol";

contract Erc721Ltoken is ERC721, ILtoken {
    address public governanceAccount;
    address public treasuryPoolAddress;

    mapping(uint256 => uint256) private _tokenAmount;

    constructor(string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
    {
        governanceAccount = msg.sender;
    }

    modifier onlyBy(address account) {
        require(msg.sender == account, "Erc721Ltoken: sender not authorized");
        _;
    }

    function mint(address to, uint256 tokenId)
        external
        override
        onlyBy(treasuryPoolAddress)
    {
        _safeMint(to, tokenId);
    }

    function burn(address account, uint256 tokenId)
        external
        override
        onlyBy(treasuryPoolAddress)
    {
        require(
            ownerOf(tokenId) == account,
            "Erc721Ltoken: burn from unexpected account"
        );

        delete _tokenAmount[tokenId];
        _burn(tokenId);
    }

    function balanceOf(address account)
        public
        view
        virtual
        override(ERC721, ILtoken)
        returns (uint256)
    {
        return ERC721.balanceOf(account);
    }

    function isNonFungibleToken() external pure override returns (bool) {
        return true;
    }

    function setTokenAmount(uint256 tokenId, uint256 amount)
        external
        override
        onlyBy(governanceAccount)
    {
        require(
            _exists(tokenId),
            "Erc721Ltoken: amount set of nonexistent token"
        );

        _tokenAmount[tokenId] = amount;
    }

    function getTokenAmount(uint256 tokenId)
        external
        view
        override
        returns (uint256)
    {
        require(
            _exists(tokenId),
            "Erc721Ltoken: amount get of nonexistent token"
        );

        return _tokenAmount[tokenId];
    }

    function setGovernanceAccount(address newGovernanceAccount)
        external
        onlyBy(governanceAccount)
    {
        require(
            newGovernanceAccount != address(0),
            "Erc721Ltoken: new governance account is the zero address"
        );

        governanceAccount = newGovernanceAccount;
    }

    function setTreasuryPoolAddress(address newTreasuryPoolAddress)
        external
        onlyBy(governanceAccount)
    {
        require(
            newTreasuryPoolAddress != address(0),
            "Erc721Ltoken: new treasury pool address is the zero address"
        );

        treasuryPoolAddress = newTreasuryPoolAddress;
    }

    function _transfer(
        address, /* sender */
        address, /* recipient */
        uint256 /* amount */
    ) internal virtual override {
        // non-transferable between users
        revert("Erc721Ltoken: token is non-transferable");
    }
}

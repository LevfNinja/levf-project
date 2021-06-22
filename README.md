# levf-protocol

## Environment variables

-   `INFURA_PROJECT_ID`: Project ID to deploy contracts using infura.io
-   `ROPSTEN_WALLET_PRIVATE_KEY`: Private key of wallet for deploying contracts to Ropsten Testnet
-   `KOVAN_WALLET_PRIVATE_KEY`: Private key of wallet for deploying contracts to Kovan Testnet
-   `MAINNET_WALLET_PRIVATE_KEY`: Private key of wallet for deploying contracts to Ethereum Mainnet
-   `BSC_TESTNET_WALLET_PRIVATE_KEY`: Private key of wallet for deploying contracts to Binance Smart Chain Testnet
-   `ROPSTEN_TEAM_ACCOUNT`: Team account for deploying contracts to Ropsten Testnet
-   `KOVAN_TEAM_ACCOUNT`: Team account for deploying contracts to Kovan Testnet
-   `MAINNET_TEAM_ACCOUNT`: Team account for deploying contracts to Ethereum Mainnet
-   `BSC_TESTNET_TEAM_ACCOUNT`: Team account for deploying contracts to Binance Smart Chain Testnet
-   `ROPSTEN_INSURANCE_FUND_ADDRESS`: Insurance fund address for deploying contracts to Ropsten Testnet
-   `KOVAN_INSURANCE_FUND_ADDRESS`: Insurance fund address for deploying contracts to Kovan Testnet
-   `MAINNET_INSURANCE_FUND_ADDRESS`: Insurance fund address for deploying contracts to Ethereum Mainnet
-   `BSC_TESTNET_INSURANCE_FUND_ADDRESS`: Insurance fund address for deploying contracts to Binance Smart Chain Testnet
-   `ROPSTEN_LFI_ADDRESS`: LFI address for deploying contracts to Ropsten Testnet
-   `KOVAN_LFI_ADDRESS`: LFI address for deploying contracts to Kovan Testnet
-   `MAINNET_LFI_ADDRESS`: LFI address for deploying contracts to Ethereum Mainnet
-   `BSC_TESTNET_LFI_ADDRESS`: LFI address for deploying contracts to Binance Smart Chain Testnet
-   `ROPSTEN_DAI_ADDRESS`: Dai address for deploying contracts to Ropsten Testnet
-   `KOVAN_DAI_ADDRESS`: Dai address for deploying contracts to Kovan Testnet
-   `ROPSTEN_UNISWAP_DAI_LFI_UNI_ADDRESS`: Uniswap DAI/LFI UNI address for deploying contracts to Ropsten Testnet
-   `KOVAN_UNISWAP_DAI_LFI_UNI_ADDRESS`: Uniswap DAI/LFI UNI address for deploying contracts to Kovan Testnet
-   `MAINNET_UNISWAP_DAI_LFI_UNI_ADDRESS`: Uniswap DAI/LFI UNI address for deploying contracts to Ethereum Mainnet
-   `ROPSTEN_YVDAI_ADDRESS`: yvDAI address for deploying contracts to Ropsten Testnet
-   `KOVAN_YVDAI_ADDRESS`: yvDAI address for deploying contracts to Kovan Testnet
-   `BSC_TESTNET_YVDAI_ADDRESS`: yvDAI address for deploying contracts to Binance Smart Chain Testnet
-   `ETHERSCAN_API_KEY`: API Key to verify contracts on etherscan.io
-   `BSCSCAN_API_KEY`: API Key to verify contracts on bscscan.com

> **Tip:** You can use dotenv easily set the environment variables

## Run Tests

1. Run `npm test`

## Deployment

1. Run tests
2. Run a local Ethereum network using `npm run hardhat-node`
3. Test migration script locally using `npm run migrate-local`
4. Run corresponding migration command (e.g. `npm run migrate-lfi-ropsten`) to deploy the first stage contracts or specific contract to chosen network

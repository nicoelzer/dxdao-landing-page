import { observable, action } from 'mobx'
import { deployed } from '../config.json'
import store from './Root'

const ConfirmationFlags = {
  ENABLE_TKN: 'enable_TKN',
  DEPOSIT_TKN: 'deposit_TKN',
  ENABLE_DXD: 'enabled_DXD',
  SELL_DXD: 'sell_dxd'
}

class TradingStore {
	@observable reserveBalance = ''
	@observable price = 0

	@observable enableTKNState = 0
	@observable buyingState = 0
	@observable buyAmount = 0
	@observable priceToBuy = 0

	@observable enableDXDState = 0
	@observable sellingState = 0
	@observable sellAmount = 0
	@observable rewardForSell = 0

	@observable bondedTokenBalance = 0
	@observable bondedTokenPrice = 0

	@observable recentTrades = []
	@observable recentTradesSet = false

	// getPriceToBuy(uint256 numTokens)
	async getPriceToBuy(numTokens) {
		const contract = this.loadBondingCurveContract()
		const priceToBuy = await contract.methods.priceToBuy(numTokens).call()
		return priceToBuy
	}

	// getRewardForSell(uint256 numTokens)
	async getRewardForSell(numTokens) {
		const contract = this.loadBondingCurveContract()
		const rewardForSell = await contract.methods.rewardForSell(numTokens).call()
		return rewardForSell
	}

	// setPriceToBuy(uint256 numTokens)
	async setPriceToBuy(numTokens) {
		const priceToBuy = await this.getPriceToBuy(numTokens)
		this.priceToBuy = priceToBuy
	}

	// setRewardForSell(uint256 numTokens)
	async setRewardForSell(numTokens) {
		const rewardForSell = await this.getRewardForSell(numTokens)
		this.rewardForSell = rewardForSell
	}

	// setPrice()
	async setPrice() {
		console.log('in setPrice')
		const price = await this.getPriceToBuy(1)
		this.price = price
		console.log('price in setPrice: ' + price)
	}

	// getReserveBalance()
	async getReserveBalance() {
		const contract = this.loadBondingCurveContract()
		const reserveBalance = await contract.methods.reserveBalance().call()
		this.reserveBalance = reserveBalance
	}

	// setBondedTokenBalance()
	async setBondedTokenBalance() {
		const contract = this.loadBondedTokenContract()
		const tokenBalance = await contract.methods.balanceOf(store.providerStore.address).call()
		this.bondedTokenBalance = tokenBalance
	}

	// setBuyAmount()
	setBuyAmount(buyAmount) {
		this.setPriceToBuy(buyAmount)
		this.buyAmount = buyAmount
	}

	// setSellAmount()
	setSellAmount(sellAmount) {
		this.setRewardForSell(sellAmount)
		this.sellAmount = sellAmount
	}

	// TODO look into how to pass this as a callback??
	// setEnableTKNStateConfirmed()
	setStateConfirmed(confirmationFlag) {
		if (confirmationFlag === ConfirmationFlags.ENABLE_TKN) {
			return this.enableTKNState = 3
		} else if (confirmationFlag === ConfirmationFlags.DEPOSIT_TKN) {
			return this.buyingState = 3
		} else if (confirmationFlag === ConfirmationFlags.ENABLE_DXD) {
			return this.enableDXDState = 3
		} else if (confirmationFlag === ConfirmationFlags.SELL_DXD) {
			return this.sellingState = 3
		}
	}

	async setRecentTrades(numToGet) {
		const trades = await this.getRecentTrades(numToGet)
		this.recentTrades = trades
		this.recentTradesSet = true
	}

	enableToken(tokenType) {
		if (tokenType === "TKN") {
			this.enableCollateral()
		} else if (tokenType === "DXD") {
			this.enableDXD()
		}
	}

	// getSellEvents
	async getSellEvents(numToGet) {
		const contract = this.loadBondingCurveContract()
		var sellEvents = await contract.getPastEvents('Sell', {fromBlock: 0, toBlock: 'latest'})
		sellEvents = sellEvents.slice(0, numToGet)
		const parsedSellEvents = Promise.all(sellEvents.map(sellEvent => this.formatSellEvent(sellEvent)))
		return parsedSellEvents
	}

	// format sell event
	async formatSellEvent(sellEvent) {
		const container = {};
		const amount = sellEvent.returnValues.amount;
		const totalReceived = sellEvent.returnValues.reward;
		console.log("Burn reward: " + sellEvent.returnValues.reward);
		container.amount = sellEvent.returnValues.amount;
		container.price = totalReceived / amount;
		container.totalReceived = totalReceived;
		container.blockNumber = sellEvent.blockNumber;
		container.blockTime = await store.providerStore.getBlockTime(sellEvent.blockNumber);
		container.type = "Sell";
		container.hash = "https://kovan.etherscan.io/tx/" + sellEvent.transactionHash;
		return container;		
	}

	// getBuyEvents
	async getBuyEvents(numToGet) {
		const contract = this.loadBondingCurveContract()
		var buyEvents = await contract.getPastEvents('Buy', {fromBlock: 0, toBlock: 'latest'})
		buyEvents = buyEvents.slice(0, numToGet)
		return Promise.all(buyEvents.map(buyEvent => this.formatBuyEvent(buyEvent)))
	}

	// format buy event
	async formatBuyEvent(buyEvent) {
		const container = {};
		const amount = buyEvent.returnValues.amount;
		const price = buyEvent.returnValues.price;
		container.amount = amount;
		container.price = price;
		container.totalPaid = price * amount;
		container.blockNumber = buyEvent.blockNumber;
		container.blockTime = await store.providerStore.getBlockTime(buyEvent.blockNumber);
		container.type = "Buy";
		container.hash = "https://kovan.etherscan.io/tx/" + buyEvent.transactionHash;
		return container;
	}

	// getRecentTrades(numberOfTrades)
	async getRecentTrades(numberOfTrades) {
		const buyEvents = await this.getBuyEvents(numberOfTrades)
		const sellEvents = await this.getSellEvents(numberOfTrades)
		var combinedTrades = buyEvents.concat(sellEvents)
		combinedTrades = combinedTrades.sort(function(a,b){return b.blockNumber - a.blockNumber})
		const sortedRecentTrades = combinedTrades.slice(0, numberOfTrades)
		return sortedRecentTrades
	}

	// TODO Separate ERC20 version from ETH version
	// Enable Collateral Token (ERC20 Version)
	@action enableCollateral = async () => {
		this.enableTKNState = 1
		const contract = this.loadCollateralTokenContract()
		const spender = deployed.BondingCurve

		try {
			// TODO set approve to a very large number
			await contract.methods.approve(spender, 40000).send()
			.on('transactionHash', function(hash){
				store.providerStore.checkConfirmation(hash, ConfirmationFlags.ENABLE_TKN)
			})

			// Debugging; TODO remove debugging
			const x = await contract.methods.allowance(store.providerStore.address, spender).call()
			console.log("approve initiated; allowance is " + x.toString() + ' enable state: ' + this.enableTKNState)

			this.enableTKNState = 2
		} catch (e) {
			// TODO set up logging
			console.log(e)
		}
	}

	// Enable DXD
	// @action enable = async 
	@action enableDXD = async () => {
		this.enableDXDState = 1
		const contract = this.loadBondedTokenContract()
		const spender = deployed.BondingCurve

		try {
			// TODO set approve to a very large number
			await contract.methods.approve(spender, 4000).send()
			.on('transactionHash', function(hash){
				store.providerStore.checkConfirmation(hash, ConfirmationFlags.ENABLE_DXD)
			})

			this.enableDXDState = 2
		} catch (e) {
			// TODO set up logging
			console.log(e)
		}
	}

	// buy(uint256 numTokens, uint256 maxPrice, address recipient)
	@action buy = async () => {
		const contract = this.loadBondingCurveContract()
		const recipient = store.providerStore.address
		// TODO figure out how to set maxPrice
		const maxPrice = 1000

		try {
			await contract.methods.buy(this.buyAmount, maxPrice, recipient).send()
			.on('transactionHash', function(hash){
				store.providerStore.checkConfirmation(hash, ConfirmationFlags.DEPOSIT_TKN)
			})
			console.log('buy executed for ' + this.buyAmount)
			this.getReserveBalance()
			this.buyingState = 2
		} catch (e) {
			// TODO set up logging
			console.log(e)
		}
	}

	// sell(uint256 numTokens, uint256 minPrice, address recipient)
	@action sell = async () => {
		const contract = this.loadBondingCurveContract()
		const recipient = store.providerStore.address
		// TODO figure out how to set minPrice
		const minPrice = 0

		try {
			await contract.methods.sell(this.sellAmount, minPrice, recipient).send()
			.on('transactionHash', function(hash){
				store.providerStore.checkConfirmation(hash, ConfirmationFlags.SELL_DXD)
			})
			console.log('sell executed for ' + this.sellAmount)
			// TODO figure out how to be polling for updates to displayed values
			this.getReserveBalance()
			this.sellingState = 2
		} catch (e) {
			// TODO set up logging
			console.log(e)
		}
	}

    loadBondedTokenContract() {
        return store.providerStore.loadObject('BondedToken', deployed.BondedToken, 'BondedToken')
    }

    loadBondingCurveContract() {
        return store.providerStore.loadObject('BondingCurve', deployed.BondingCurve, 'BondingCurve')
    }

    loadRewardsDistributorContract() {
        return store.providerStore.loadObject('RewardsDistributor', deployed.RewardsDistributor, 'RewardsDistributor')
    }

    // loadCollateralTokenContract (ERC20 Version)
    loadCollateralTokenContract() {
    	return store.providerStore.loadObject('CollateralToken', deployed.CollateralToken, 'CollateralToken')
    }
}

export default TradingStore
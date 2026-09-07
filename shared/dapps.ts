/**
 * 三方连接第一版：本地精选列表，点击后在应用内浏览器打开。
 */
export type DappCategoryId = 'hot' | 'swap' | 'stocks' | 'betting' | 'games' | 'faucet'

export interface DappCategory {
  id: DappCategoryId
  label: string
}

export interface DappEntry {
  id: string
  category: DappCategoryId
  name: string
  url: string
  remark: string
}

export const DAPP_CATEGORIES: readonly DappCategory[] = [
  { id: 'hot', label: '热门 DApp' },
  { id: 'swap', label: '兑换' },
  { id: 'stocks', label: '股票' },
  { id: 'betting', label: '博彩' },
  { id: 'games', label: '游戏' },
  { id: 'faucet', label: '领水' },
]

export const DAPP_ENTRIES: readonly DappEntry[] = [
  {
    id: 'uniswap',
    category: 'hot',
    name: 'Uniswap',
    url: 'https://app.uniswap.org/',
    remark: '以太坊及 L2 去中心化交易',
  },
  {
    id: 'pancake',
    category: 'hot',
    name: 'PancakeSwap',
    url: 'https://pancakeswap.finance/swap',
    remark: 'BSC 上常用兑换',
  },
  {
    id: 'jupiter',
    category: 'hot',
    name: 'Jupiter',
    url: 'https://jup.ag/',
    remark: 'Solana 聚合兑换',
  },
  {
    id: 'aave',
    category: 'hot',
    name: 'Aave',
    url: 'https://app.aave.com/',
    remark: '借贷协议',
  },
  {
    id: 'opensea',
    category: 'hot',
    name: 'OpenSea',
    url: 'https://opensea.io/',
    remark: 'NFT 市场',
  },
  {
    id: 'swap-pancake',
    category: 'swap',
    name: 'PancakeSwap',
    url: 'https://pancakeswap.finance/swap',
    remark: 'BSC / 多链兑换',
  },
  {
    id: 'swap-uniswap',
    category: 'swap',
    name: 'Uniswap',
    url: 'https://app.uniswap.org/',
    remark: '以太坊 / L2 兑换',
  },
  {
    id: 'swap-1inch',
    category: 'swap',
    name: '1inch',
    url: 'https://app.1inch.io/',
    remark: '多聚合器比价',
  },
  {
    id: 'swap-jupiter',
    category: 'swap',
    name: 'Jupiter',
    url: 'https://jup.ag/',
    remark: 'Solana 兑换',
  },
  {
    id: 'stocks-gmx',
    category: 'stocks',
    name: 'GMX',
    url: 'https://app.gmx.io/#/trade',
    remark: '链上永续合约',
  },
  {
    id: 'stocks-dydx',
    category: 'stocks',
    name: 'dYdX',
    url: 'https://dydx.trade/',
    remark: '去中心化衍生品',
  },
  {
    id: 'betting-azuro',
    category: 'betting',
    name: 'Azuro',
    url: 'https://azuro.org/',
    remark: '链上预测 / 体育盘',
  },
  {
    id: 'betting-polymarket',
    category: 'betting',
    name: 'Polymarket',
    url: 'https://polymarket.com/',
    remark: '事件预测市场',
  },
  {
    id: 'games-magiceden',
    category: 'games',
    name: 'Magic Eden',
    url: 'https://magiceden.io/',
    remark: 'Solana / 多链 NFT 与游戏资产',
  },
  {
    id: 'games-sandbox',
    category: 'games',
    name: 'The Sandbox',
    url: 'https://www.sandbox.game/',
    remark: '链游与地块',
  },
  {
    id: 'faucet-solana',
    category: 'faucet',
    name: 'Solana Faucet',
    url: 'https://faucet.solana.com/',
    remark: 'Devnet / Testnet SOL',
  },
  {
    id: 'faucet-alchemy',
    category: 'faucet',
    name: 'Alchemy Faucets',
    url: 'https://www.alchemy.com/faucets',
    remark: 'Sepolia 等 EVM 测试币',
  },
  {
    id: 'faucet-google',
    category: 'faucet',
    name: 'Google Cloud Web3 Faucet',
    url: 'https://cloud.google.com/application/web3/faucet',
    remark: '多链测试币',
  },
]

export function dappsInCategory(category: DappCategoryId): DappEntry[] {
  return DAPP_ENTRIES.filter((item) => item.category === category)
}

export function dappCategoryById(id: string): DappCategory | undefined {
  return DAPP_CATEGORIES.find((item) => item.id === id)
}

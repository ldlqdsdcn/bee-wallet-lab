/**
 * 把 BeeFixedERC20 编成 ABI + bytecode，供主进程部署，运行时不再依赖 solc。
 */
import fs from 'node:fs'
import path from 'node:path'
import solc from 'solc'

const root = path.resolve(import.meta.dirname, '..')
const sourcePath = 'contracts/BeeFixedERC20.sol'
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')

function findImports(importPath) {
  const file = path.join(root, 'node_modules', importPath)
  if (!fs.existsSync(file)) return { error: `File not found: ${importPath}` }
  return { contents: fs.readFileSync(file, 'utf8') }
}

const input = {
  language: 'Solidity',
  sources: { [sourcePath]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object'],
      },
    },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
const errors = (output.errors ?? []).filter((item) => item.severity === 'error')
if (errors.length) {
  console.error(errors.map((item) => item.formattedMessage).join('\n'))
  process.exit(1)
}

const contract = output.contracts[sourcePath].BeeFixedERC20
const bytecode = `0x${contract.evm.bytecode.object}`
if (bytecode.length < 10) {
  console.error('bytecode empty')
  process.exit(1)
}

const artifact = {
  contractName: 'BeeFixedERC20',
  sourceName: sourcePath,
  compiler: { name: 'solc', version: solc.version() },
  openzeppelin: '5.7.0',
  abi: contract.abi,
  bytecode,
}

const dest = path.join(root, 'electron/main/token/beeFixedErc20.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, `${JSON.stringify(artifact, null, 2)}\n`)
console.log(`wrote ${path.relative(root, dest)} (${bytecode.length} chars)`)

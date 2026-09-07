import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type {
  AccountRecord,
  BitcoinAddressType,
  CreateWalletInput,
  ImportPrivateKeyInput,
  WalletSummary,
  WalletType,
} from '@shared/types'
import { accountApi, walletApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Modal, Select, TextArea } from '../components/ui'
import { shorten, walletTypeLabel } from '../lib/format'
import { useWalletStore } from '../store/walletStore'

type Wizard = 'idle' | 'create' | 'confirm' | 'import' | 'importKey'

const WALLET_NAME_MAX_LENGTH = 200

const ADDRESS_TYPES: { value: BitcoinAddressType; label: string }[] = [
  { value: 'p2wpkh', label: 'Native SegWit (bc1q)' },
  { value: 'p2tr', label: 'Taproot (bc1p)' },
  { value: 'p2sh-p2wpkh', label: 'Nested SegWit (3…)' },
  { value: 'p2pkh', label: 'Legacy (1…)' },
]

export default function WalletsPage() {
  const location = useLocation()
  const reloadCurrent = useWalletStore((s) => s.load)
  const selectWallet = useWalletStore((s) => s.select)
  const [wallets, setWallets] = useState<WalletSummary[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wizard, setWizard] = useState<Wizard>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [createForm, setCreateForm] = useState<CreateWalletInput>({ name: '', mnemonicLength: 12 })
  const [draftId, setDraftId] = useState('')
  const [words, setWords] = useState<string[]>([])
  const [challenge, setChallenge] = useState<number[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [importName, setImportName] = useState('')
  const [importMnemonic, setImportMnemonic] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [keyForm, setKeyForm] = useState<ImportPrivateKeyInput>({
    walletType: 'web3',
    networkScope: 'mainnet',
    privateKey: '',
    label: '',
  })
  const [revealPrompt, setRevealPrompt] = useState<{
    kind: 'mnemonic' | 'key'
    id: string
    label: string
  } | null>(null)
  const [revealPassword, setRevealPassword] = useState('')
  const [revealBusy, setRevealBusy] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{
    kind: 'mnemonic' | 'key'
    value: string
    passphrase: string | null
    label: string
  } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [deleting, setDeleting] = useState<WalletSummary | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const backupConsumed = useRef<string | null>(null)

  const load = useCallback(async (walletId?: string) => {
    const list = await walletApi.list()
    setWallets(list)
    const keep = walletId ?? selectedId
    const nextId =
      (keep && list.some((item) => item.id === keep) ? keep : null) ??
      list.find((item) => item.isDefault)?.id ??
      list[0]?.id ??
      null
    setSelectedId(nextId)
    setAccounts(nextId ? await accountApi.list(nextId) : [])
    void reloadCurrent()
  }, [reloadCurrent, selectedId])

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [load])

  useEffect(() => {
    const state = location.state as { wizard?: Wizard; backup?: boolean } | null
    if (state?.wizard === 'create' || state?.wizard === 'import') setWizard(state.wizard)
  }, [location.state])

  useEffect(() => {
    const state = location.state as { backup?: boolean } | null
    if (!state?.backup || wallets.length === 0) return
    if (backupConsumed.current === location.key) return
    backupConsumed.current = location.key
    const current = wallets.find((item) => item.isDefault) ?? wallets[0]
    if (!current) return
    setSelectedId(current.id)
    setRevealPrompt({ kind: 'mnemonic', id: current.id, label: current.name })
    setRevealPassword('')
    setRevealError(null)
  }, [location.key, location.state, wallets])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const selected = wallets.find((item) => item.id === selectedId) ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-200">钱包与账户</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setWizard('import')}>
            导入助记词
          </Button>
          <Button variant="ghost" onClick={() => setWizard('importKey')}>
            导入私钥
          </Button>
          <Button onClick={() => setWizard('create')}>创建钱包</Button>
        </div>
      </div>

      <Alert>{error}</Alert>

      {wizard === 'create' || wizard === 'confirm' ? (
        <Card title={wizard === 'create' ? '创建钱包' : '确认助记词'}>
          {wizard === 'create' ? (
            <div className="space-y-3">
              <Field
                label="钱包名称"
                maxLength={WALLET_NAME_MAX_LENGTH}
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm({ ...createForm, name: e.target.value.slice(0, WALLET_NAME_MAX_LENGTH) })
                }
              />
              <Select
                label="助记词长度"
                value={createForm.mnemonicLength}
                onChange={(e) =>
                  setCreateForm({ ...createForm, mnemonicLength: Number(e.target.value) as 12 | 24 })
                }
              >
                <option value={12}>12 词</option>
                <option value={24}>24 词</option>
              </Select>
              <Field
                label="Passphrase（可选）"
                value={createForm.passphrase ?? ''}
                hint="BIP-39 第 25 词，会改变整棵派生树。忘记则无法恢复。"
                onChange={(e) => setCreateForm({ ...createForm, passphrase: e.target.value })}
              />
              <div className="flex gap-2">
                <Button
                  disabled={busy || !createForm.name}
                  onClick={() =>
                    void run(async () => {
                      const draft = await walletApi.createDraft(createForm)
                      setDraftId(draft.draftId)
                      setWords(draft.words)
                      setChallenge(draft.challengeIndexes)
                      setAnswers({})
                      setWizard('confirm')
                    })
                  }
                >
                  生成助记词
                </Button>
                <Button variant="ghost" onClick={() => setWizard('idle')}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink-400">请离线抄写，确认后本页不再展示完整助记词。</p>
              <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {words.map((word, index) => (
                  <li key={index} className="sensitive rounded-lg bg-ink-900 px-2 py-1 text-xs text-ink-200">
                    <span className="mr-1 text-ink-600">{index + 1}.</span>
                    {word}
                  </li>
                ))}
              </ol>
              <div className="grid grid-cols-3 gap-3">
                {challenge.map((index) => (
                  <Field
                    key={index}
                    label={`第 ${index} 个单词`}
                    value={answers[String(index)] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [String(index)]: e.target.value })}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const wallet = await walletApi.confirmDraft(draftId, answers)
                      setWizard('idle')
                      setWords([])
                      await selectWallet(wallet.id)
                      await load(wallet.id)
                    })
                  }
                >
                  确认并保存
                </Button>
                <Button variant="ghost" onClick={() => setWizard('idle')}>
                  放弃
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {wizard === 'import' ? (
        <Card title="导入助记词">
          <div className="space-y-3">
            <Field
              label="钱包名称"
              maxLength={WALLET_NAME_MAX_LENGTH}
              value={importName}
              onChange={(e) => setImportName(e.target.value.slice(0, WALLET_NAME_MAX_LENGTH))}
            />
            <TextArea
              label="助记词"
              className="sensitive"
              value={importMnemonic}
              placeholder="用空格分隔"
              onChange={(e) => setImportMnemonic(e.target.value)}
            />
            <Field
              label="Passphrase（如有）"
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                disabled={busy || !importName || !importMnemonic}
                onClick={() =>
                  void run(async () => {
                    const wallet = await walletApi.importMnemonic({
                      name: importName,
                      mnemonic: importMnemonic,
                      passphrase: importPassphrase || undefined,
                    })
                    setWizard('idle')
                    setImportMnemonic('')
                    await selectWallet(wallet.id)
                    await load(wallet.id)
                  })
                }
              >
                导入
              </Button>
              <Button variant="ghost" onClick={() => setWizard('idle')}>
                取消
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {wizard === 'importKey' ? (
        <Card title="导入私钥">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="链"
              value={keyForm.walletType}
              onChange={(e) => setKeyForm({ ...keyForm, walletType: e.target.value as WalletType })}
            >
              <option value="web3">EVM</option>
              <option value="bitcoin">Bitcoin</option>
              <option value="tron">TRON</option>
              <option value="solana">Solana</option>
            </Select>
            <Select
              label="网络"
              value={keyForm.networkScope}
              onChange={(e) =>
                setKeyForm({ ...keyForm, networkScope: e.target.value as 'mainnet' | 'testnet' })
              }
            >
              <option value="mainnet">主网</option>
              <option value="testnet">测试网</option>
            </Select>
            {keyForm.walletType === 'bitcoin' ? (
              <Select
                label="地址格式"
                value={keyForm.addressType ?? 'p2wpkh'}
                onChange={(e) =>
                  setKeyForm({ ...keyForm, addressType: e.target.value as BitcoinAddressType })
                }
              >
                {ADDRESS_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            ) : null}
            <Field label="备注" value={keyForm.label ?? ''} onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })} />
            <div className="col-span-2">
              <TextArea
                label="私钥"
                className="sensitive"
                value={keyForm.privateKey}
                hint="EVM / TRON 为 64 位 hex，Bitcoin 可用 WIF，Solana 为 32 字节 hex 或 Base58 secret key"
                onChange={(e) => setKeyForm({ ...keyForm, privateKey: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={busy || !keyForm.privateKey}
              onClick={() =>
                void run(async () => {
                  await accountApi.importPrivateKey(keyForm)
                  setWizard('idle')
                  setKeyForm({ ...keyForm, privateKey: '' })
                  await load(selectedId ?? undefined)
                })
              }
            >
              导入账户
            </Button>
            <Button variant="ghost" onClick={() => setWizard('idle')}>
              取消
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <Card title="钱包">
          {wallets.length === 0 ? (
            <p className="text-sm text-ink-400">还没有钱包。先创建或导入一个。</p>
          ) : (
            <ul className="space-y-1">
              {wallets.map((wallet) => (
                <li key={wallet.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      wallet.id === selectedId ? 'bg-ink-700 text-honey-400' : 'text-ink-300 hover:bg-ink-800'
                    }`}
                    onClick={() => {
                      setRenaming(false)
                      void load(wallet.id)
                    }}
                  >
                    <span className="block truncate">{wallet.name}</span>
                    <span className="text-[11px] text-ink-500">
                      {wallet.mnemonicLength} 词 · {wallet.accountCount} 个账户
                      {wallet.isDefault ? ' · 当前' : ''}
                      {wallet.isAuthWallet ? ' · 鉴权' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={selected ? selected.name : '账户'}
          action={
            selected ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    setRenaming(true)
                    setRenameName(selected.name)
                  }}
                >
                  重命名
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => void selectWallet(selected.id).then(() => load(selected.id))}
                >
                  设为当前
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void walletApi.setAuthWallet(selected.id).then(() => load(selected.id))}>
                  用于鉴权
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    setRevealPrompt({ kind: 'mnemonic', id: selected.id, label: selected.name })
                    setRevealPassword('')
                    setRevealError(null)
                  }}
                >
                  导出助记词
                </Button>
                <Button
                  variant="danger"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    setDeleting(selected)
                    setDeletePassword('')
                    setError(null)
                  }}
                >
                  删除
                </Button>
              </div>
            ) : null
          }
        >
          {renaming && selected ? (
            <div className="mb-4 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  label="钱包名称"
                  maxLength={WALLET_NAME_MAX_LENGTH}
                  value={renameName}
                  autoFocus
                  onChange={(e) => setRenameName(e.target.value.slice(0, WALLET_NAME_MAX_LENGTH))}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setRenaming(false)
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void run(async () => {
                        await walletApi.rename(selected.id, renameName.trim())
                        setRenaming(false)
                        await load(selected.id)
                      })
                    }
                  }}
                />
              </div>
              <Button
                className="px-3 py-2 text-xs"
                disabled={busy || !renameName.trim()}
                onClick={() =>
                  void run(async () => {
                    await walletApi.rename(selected.id, renameName.trim())
                    setRenaming(false)
                    await load(selected.id)
                  })
                }
              >
                保存
              </Button>
              <Button variant="ghost" className="px-3 py-2 text-xs" onClick={() => setRenaming(false)}>
                取消
              </Button>
            </div>
          ) : null}

          {accounts.length === 0 ? (
            <p className="text-sm text-ink-400">该钱包还没有账户。</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-200">{account.label || '未命名'}</span>
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-400">
                        {walletTypeLabel(account.walletType)}
                      </span>
                      {account.addressType ? (
                        <span className="text-[10px] text-ink-500">{account.addressType}</span>
                      ) : null}
                    </div>
                    <p className="sensitive mt-0.5 truncate text-xs text-ink-400">{shorten(account.address)}</p>
                    {account.rootPath ? <p className="text-[11px] text-ink-600">{account.rootPath}</p> : null}
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => {
                      setRevealPrompt({
                        kind: 'key',
                        id: account.id,
                        label: account.label || shorten(account.address),
                      })
                      setRevealPassword('')
                      setRevealError(null)
                    }}
                  >
                    私钥
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {selected ? (
            <DeriveBar
              walletId={selected.id}
              busy={busy}
              onDerived={() => void load(selected.id)}
              onError={setError}
            />
          ) : null}
        </Card>
      </div>

      {revealPrompt ? (
        <PasswordPromptDialog
          kind={revealPrompt.kind}
          label={revealPrompt.label}
          password={revealPassword}
          busy={revealBusy}
          error={revealError}
          onPassword={setRevealPassword}
          onCancel={() => {
            setRevealPrompt(null)
            setRevealPassword('')
            setRevealError(null)
          }}
          onConfirm={() => {
            void (async () => {
              setRevealBusy(true)
              setRevealError(null)
              try {
                if (revealPrompt.kind === 'mnemonic') {
                  const exported = await walletApi.exportMnemonic(revealPrompt.id, revealPassword)
                  setRevealed({
                    kind: 'mnemonic',
                    value: exported.mnemonic,
                    passphrase: exported.passphrase,
                    label: revealPrompt.label,
                  })
                } else {
                  const value = await accountApi.revealPrivateKey(revealPrompt.id, revealPassword)
                  setRevealed({
                    kind: 'key',
                    value,
                    passphrase: null,
                    label: revealPrompt.label,
                  })
                }
                setRevealPrompt(null)
                setRevealPassword('')
              } catch (err) {
                setRevealError(err instanceof Error ? err.message : String(err))
              } finally {
                setRevealBusy(false)
              }
            })()
          }}
        />
      ) : null}

      {revealed ? (
        <SecretRevealDialog secret={revealed} onClose={() => setRevealed(null)} />
      ) : null}

      {deleting ? (
        <DeleteWalletDialog
          wallet={deleting}
          password={deletePassword}
          busy={busy}
          error={error}
          onPassword={setDeletePassword}
          onCancel={() => {
            setDeleting(null)
            setDeletePassword('')
            setError(null)
          }}
          onConfirm={() =>
            void run(async () => {
              await walletApi.remove(deleting.id, deletePassword)
              setDeleting(null)
              setDeletePassword('')
              await load()
            })
          }
        />
      ) : null}
    </div>
  )
}

function PasswordPromptDialog({
  kind,
  label,
  password,
  busy,
  error,
  onPassword,
  onCancel,
  onConfirm,
}: {
  kind: 'mnemonic' | 'key'
  label: string
  password: string
  busy: boolean
  error: string | null
  onPassword: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal title={kind === 'mnemonic' ? '导出助记词' : '查看私钥'} onClose={onCancel}>
      <p className="mt-2 text-sm text-ink-400">
        {kind === 'mnemonic'
          ? `输入主密码后，将单独打开窗口显示「${label}」的助记词。`
          : `输入主密码后，将单独打开窗口显示「${label}」的私钥。`}
      </p>
      <div className="mt-4">
        <Field
          label="主密码"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password && !busy) onConfirm()
          }}
        />
      </div>
      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={busy || !password} onClick={onConfirm}>
          {busy ? '校验中…' : '确认'}
        </Button>
      </div>
    </Modal>
  )
}

function SecretRevealDialog({
  secret,
  onClose,
}: {
  secret: { kind: 'mnemonic' | 'key'; value: string; passphrase: string | null; label: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const words = secret.kind === 'mnemonic' ? secret.value.trim().split(/\s+/) : []

  const copy = async () => {
    await navigator.clipboard.writeText(secret.value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal title={secret.kind === 'mnemonic' ? '助记词' : '私钥'} onClose={onClose} wide={secret.kind === 'mnemonic'}>
      <p className="mt-2 text-xs text-ink-500">
        {secret.label} · 请勿截图、勿发给任何人。关闭窗口后不再显示。
      </p>
      {secret.kind === 'mnemonic' ? (
        <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {words.map((word, index) => (
            <li key={index} className="sensitive rounded-lg bg-ink-800 px-2 py-1.5 text-xs text-ink-200">
              <span className="mr-1 text-ink-600">{index + 1}.</span>
              {word}
            </li>
          ))}
        </ol>
      ) : (
        <p className="sensitive mt-4 break-all rounded-lg bg-ink-800 px-3 py-3 font-mono text-sm text-honey-400">
          {secret.value}
        </p>
      )}
      {secret.passphrase ? (
        <p className="mt-3 text-xs text-ink-400">
          Passphrase：<span className="sensitive text-ink-200">{secret.passphrase}</span>
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void copy()}>
          {copied ? '已复制' : '复制'}
        </Button>
        <Button onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  )
}

function DeleteWalletDialog({
  wallet,
  password,
  busy,
  error,
  onPassword,
  onCancel,
  onConfirm,
}: {
  wallet: WalletSummary
  password: string
  busy: boolean
  error: string | null
  onPassword: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal title="删除钱包" onClose={onCancel}>
      <p className="mt-2 text-sm text-ink-400">
        确定删除「{wallet.name}」？助记词和账户将从本机清除，无法恢复。
      </p>
      <div className="mt-4">
        <Field
          label="主密码"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password && !busy) onConfirm()
          }}
        />
      </div>
      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button variant="danger" disabled={busy || !password} onClick={onConfirm}>
          {busy ? '删除中…' : '确认删除'}
        </Button>
      </div>
    </Modal>
  )
}

function DeriveBar({
  walletId,
  busy,
  onDerived,
  onError,
}: {
  walletId: string
  busy: boolean
  onDerived: () => void
  onError: (message: string) => void
}) {
  const [walletType, setWalletType] = useState<WalletType>('web3')
  const [networkScope, setNetworkScope] = useState<'mainnet' | 'testnet'>('mainnet')
  const [addressType, setAddressType] = useState<BitcoinAddressType>('p2wpkh')

  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink-700 pt-4">
      <Select label="派生链" value={walletType} onChange={(e) => setWalletType(e.target.value as WalletType)}>
        <option value="web3">EVM</option>
        <option value="bitcoin">Bitcoin</option>
        <option value="tron">TRON</option>
        <option value="solana">Solana</option>
      </Select>
      <Select
        label="网络"
        value={networkScope}
        onChange={(e) => setNetworkScope(e.target.value as 'mainnet' | 'testnet')}
      >
        <option value="mainnet">主网</option>
        <option value="testnet">测试网</option>
      </Select>
      {walletType === 'bitcoin' ? (
        <Select
          label="格式"
          value={addressType}
          onChange={(e) => setAddressType(e.target.value as BitcoinAddressType)}
        >
          {ADDRESS_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      ) : null}
      <Button
        disabled={busy}
        onClick={() => {
          void accountApi
            .derive({
              walletId,
              walletType,
              networkScope,
              addressType: walletType === 'bitcoin' ? addressType : undefined,
            })
            .then(onDerived)
            .catch((err) => onError(err instanceof Error ? err.message : String(err)))
        }}
      >
        派生下一个账户
      </Button>
    </div>
  )
}

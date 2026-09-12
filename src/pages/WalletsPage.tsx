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
import { useT } from '../i18n'
import { useWalletStore } from '../store/walletStore'

type Wizard = 'idle' | 'create' | 'confirm' | 'import' | 'importKey'
type Pending = 'generate' | 'confirm' | 'import' | 'importKey' | null

const WALLET_NAME_MAX_LENGTH = 200

const ADDRESS_TYPES: { value: BitcoinAddressType; label: string }[] = [
  { value: 'p2wpkh', label: 'Native SegWit (bc1q)' },
  { value: 'p2tr', label: 'Taproot (bc1p)' },
  { value: 'p2sh-p2wpkh', label: 'Nested SegWit (3…)' },
  { value: 'p2pkh', label: 'Legacy (1…)' },
]

export default function WalletsPage() {
  const t = useT()
  const location = useLocation()
  const reloadCurrent = useWalletStore((s) => s.load)
  const selectWallet = useWalletStore((s) => s.select)
  const [wallets, setWallets] = useState<WalletSummary[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wizard, setWizard] = useState<Wizard>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

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

  const run = async (fn: () => Promise<void>, kind?: Pending) => {
    setBusy(true)
    if (kind) setPending(kind)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const openWizard = (next: Wizard) => {
    setError(null)
    setWizard(next)
  }

  const closeWizard = () => {
    if (pending) return
    setWizard('idle')
    setError(null)
    setWords([])
    setDraftId('')
    setAnswers({})
    setImportMnemonic('')
    setKeyForm((current) => ({ ...current, privateKey: '' }))
  }

  const selected = wallets.find((item) => item.id === selectedId) ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-200">{t('wallets.title')}</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => openWizard('import')}>
            {t('wallets.importMnemonic')}
          </Button>
          <Button variant="ghost" onClick={() => openWizard('importKey')}>
            {t('wallets.importKey')}
          </Button>
          <Button onClick={() => openWizard('create')}>{t('wallets.create')}</Button>
        </div>
      </div>

      {wizard === 'idle' ? <Alert>{error}</Alert> : null}

      {wizard === 'create' || wizard === 'confirm' ? (
        <Modal
          title={wizard === 'create' ? t('wallets.create') : t('wallets.confirmMnemonic')}
          wide
          onClose={closeWizard}
        >
          <div className="mt-4 space-y-3">
            <Alert>{error}</Alert>
            {wizard === 'create' ? (
              <>
                <Field
                  label={t('wallets.walletName')}
                  maxLength={WALLET_NAME_MAX_LENGTH}
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, name: e.target.value.slice(0, WALLET_NAME_MAX_LENGTH) })
                  }
                />
                <Select
                  label={t('wallets.mnemonicLen')}
                  value={createForm.mnemonicLength}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, mnemonicLength: Number(e.target.value) as 12 | 24 })
                  }
                >
                  <option value={12}>{t('wallets.words', { count: 12 })}</option>
                  <option value={24}>{t('wallets.words', { count: 24 })}</option>
                </Select>
                <Field
                  label={t('wallets.passphrase')}
                  value={createForm.passphrase ?? ''}
                  hint={t('wallets.passphraseHint')}
                  onChange={(e) => setCreateForm({ ...createForm, passphrase: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" disabled={Boolean(pending)} onClick={closeWizard}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    loading={pending === 'generate'}
                    disabled={busy || !createForm.name}
                    onClick={() =>
                      void run(async () => {
                        const draft = await walletApi.createDraft(createForm)
                        setDraftId(draft.draftId)
                        setWords(draft.words)
                        setChallenge(draft.challengeIndexes)
                        setAnswers({})
                        setWizard('confirm')
                      }, 'generate')
                    }
                  >
                    {pending === 'generate' ? t('wallets.generating') : t('wallets.generate')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-ink-400">{t('wallets.copyHint')}</p>
                <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {words.map((word, index) => (
                    <li key={index} className="sensitive rounded-lg bg-ink-800 px-2 py-1 text-xs text-ink-200">
                      <span className="mr-1 text-ink-600">{index + 1}.</span>
                      {word}
                    </li>
                  ))}
                </ol>
                <div className="grid grid-cols-3 gap-3">
                  {challenge.map((index) => (
                    <Field
                      key={index}
                      label={t('wallets.wordN', { index })}
                      value={answers[String(index)] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [String(index)]: e.target.value })}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" disabled={Boolean(pending)} onClick={closeWizard}>
                    {t('wallets.discard')}
                  </Button>
                  <Button
                    loading={pending === 'confirm'}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const wallet = await walletApi.confirmDraft(draftId, answers)
                        setWizard('idle')
                        setWords([])
                        await selectWallet(wallet.id)
                        await load(wallet.id)
                      }, 'confirm')
                    }
                  >
                    {pending === 'confirm' ? t('wallets.savingWallet') : t('wallets.confirmSave')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      ) : null}

      {wizard === 'import' ? (
        <Modal title={t('wallets.importMnemonic')} wide onClose={closeWizard}>
          <div className="mt-4 space-y-3">
            <Alert>{error}</Alert>
            <Field
              label={t('wallets.walletName')}
              maxLength={WALLET_NAME_MAX_LENGTH}
              value={importName}
              onChange={(e) => setImportName(e.target.value.slice(0, WALLET_NAME_MAX_LENGTH))}
            />
            <TextArea
              label={t('wallets.mnemonic')}
              className="sensitive"
              value={importMnemonic}
              placeholder={t('wallets.mnemonicPh')}
              onChange={(e) => setImportMnemonic(e.target.value)}
            />
            <Field
              label={t('wallets.passphraseIf')}
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={Boolean(pending)} onClick={closeWizard}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={pending === 'import'}
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
                  }, 'import')
                }
              >
                {pending === 'import' ? t('wallets.importing') : t('wallets.import')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {wizard === 'importKey' ? (
        <Modal title={t('wallets.importKey')} wide onClose={closeWizard}>
          <div className="mt-4 space-y-3">
            <Alert>{error}</Alert>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t('wallets.chain')}
                value={keyForm.walletType}
                onChange={(e) => setKeyForm({ ...keyForm, walletType: e.target.value as WalletType })}
              >
                <option value="web3">EVM</option>
                <option value="bitcoin">Bitcoin</option>
                <option value="tron">TRON</option>
                <option value="solana">Solana</option>
              </Select>
              <Select
                label={t('common.network')}
                value={keyForm.networkScope}
                onChange={(e) =>
                  setKeyForm({ ...keyForm, networkScope: e.target.value as 'mainnet' | 'testnet' })
                }
              >
                <option value="mainnet">{t('common.mainnet')}</option>
                <option value="testnet">{t('common.testnet')}</option>
              </Select>
              {keyForm.walletType === 'bitcoin' ? (
                <Select
                  label={t('wallets.addressType')}
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
              <Field
                label={t('wallets.note')}
                value={keyForm.label ?? ''}
                onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })}
              />
              <div className="col-span-2">
                <TextArea
                  label={t('wallets.privateKey')}
                  className="sensitive"
                  value={keyForm.privateKey}
                  hint={t('wallets.keyHint')}
                  onChange={(e) => setKeyForm({ ...keyForm, privateKey: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={Boolean(pending)} onClick={closeWizard}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={pending === 'importKey'}
                disabled={busy || !keyForm.privateKey}
                onClick={() =>
                  void run(async () => {
                    await accountApi.importPrivateKey(keyForm)
                    setWizard('idle')
                    setKeyForm({ ...keyForm, privateKey: '' })
                    await load(selectedId ?? undefined)
                  }, 'importKey')
                }
              >
                {pending === 'importKey' ? t('wallets.importingAccount') : t('wallets.importAccount')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <Card title={t('wallets.list')}>
          {wallets.length === 0 ? (
            <p className="text-sm text-ink-400">{t('wallets.empty')}</p>
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
                      {t('wallets.meta', { words: wallet.mnemonicLength, accounts: wallet.accountCount })}
                      {wallet.isDefault ? ` · ${t('common.current')}` : ''}
                      {wallet.isAuthWallet ? ` · ${t('wallets.auth')}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={selected ? selected.name : t('wallets.accounts')}
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
                  {t('wallets.rename')}
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => void selectWallet(selected.id).then(() => load(selected.id))}
                >
                  {t('wallets.setCurrent')}
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void walletApi.setAuthWallet(selected.id).then(() => load(selected.id))}>
                  {t('wallets.useAuth')}
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
                  {t('wallets.exportMnemonic')}
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
                  {t('common.delete')}
                </Button>
              </div>
            ) : null
          }
        >
          {renaming && selected ? (
            <div className="mb-4 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  label={t('wallets.walletName')}
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
                {t('common.save')}
              </Button>
              <Button variant="ghost" className="px-3 py-2 text-xs" onClick={() => setRenaming(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : null}

          {accounts.length === 0 ? (
            <p className="text-sm text-ink-400">{t('wallets.noAccounts')}</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-200">{account.label || t('wallets.unnamed')}</span>
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
                    {t('wallets.privateKey')}
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
  const t = useT()
  return (
    <Modal title={kind === 'mnemonic' ? t('wallets.exportTitle') : t('wallets.revealKey')} onClose={onCancel}>
      <p className="mt-2 text-sm text-ink-400">
        {kind === 'mnemonic'
          ? t('wallets.exportBody', { label })
          : t('wallets.revealBody', { label })}
      </p>
      <div className="mt-4">
        <Field
          label={t('common.password')}
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
          {t('common.cancel')}
        </Button>
        <Button disabled={busy || !password} onClick={onConfirm}>
          {busy ? t('wallets.checking') : t('common.confirm')}
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
  const t = useT()
  const [copied, setCopied] = useState(false)
  const words = secret.kind === 'mnemonic' ? secret.value.trim().split(/\s+/) : []

  const copy = async () => {
    await navigator.clipboard.writeText(secret.value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal title={secret.kind === 'mnemonic' ? t('wallets.mnemonic') : t('wallets.privateKey')} onClose={onClose} wide={secret.kind === 'mnemonic'}>
      <p className="mt-2 text-xs text-ink-500">
        {t('wallets.secretWarn', { label: secret.label })}
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
          {t('wallets.passphraseIf')}: <span className="sensitive text-ink-200">{secret.passphrase}</span>
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void copy()}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button onClick={onClose}>{t('common.close')}</Button>
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
  const t = useT()
  return (
    <Modal title={t('wallets.deleteTitle')} onClose={onCancel}>
      <p className="mt-2 text-sm text-ink-400">
        {t('wallets.deleteBody', { name: wallet.name })}
      </p>
      <div className="mt-4">
        <Field
          label={t('common.password')}
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
          {t('common.cancel')}
        </Button>
        <Button variant="danger" disabled={busy || !password} onClick={onConfirm}>
          {busy ? t('wallets.deleting') : t('wallets.confirmDelete')}
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
  const t = useT()
  const [walletType, setWalletType] = useState<WalletType>('web3')
  const [networkScope, setNetworkScope] = useState<'mainnet' | 'testnet'>('mainnet')
  const [addressType, setAddressType] = useState<BitcoinAddressType>('p2wpkh')

  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink-700 pt-4">
      <Select label={t('wallets.deriveChain')} value={walletType} onChange={(e) => setWalletType(e.target.value as WalletType)}>
        <option value="web3">EVM</option>
        <option value="bitcoin">Bitcoin</option>
        <option value="tron">TRON</option>
        <option value="solana">Solana</option>
      </Select>
      <Select
        label={t('common.network')}
        value={networkScope}
        onChange={(e) => setNetworkScope(e.target.value as 'mainnet' | 'testnet')}
      >
        <option value="mainnet">{t('common.mainnet')}</option>
        <option value="testnet">{t('common.testnet')}</option>
      </Select>
      {walletType === 'bitcoin' ? (
        <Select
          label={t('wallets.format')}
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
        {t('wallets.deriveNext')}
      </Button>
    </div>
  )
}

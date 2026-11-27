import { useSyncExternalStore } from 'react'
import { getOfflineState, subscribeOffline, type OfflineState } from './pwa'

const labels: Record<OfflineState, [string, string]> = {
  development: [
    'Offline installation is available in the production build.',
    'オフライン保存は本番ビルドで利用できます。',
  ],
  checking: ['Checking offline availability…', 'オフラインの準備状態を確認中…'],
  installing: [
    'Saving the app for offline use. Keep this tab open.',
    'オフライン用に保存中です。このタブを開いたままお待ちください。',
  ],
  ready: ['Ready for offline use.', 'オフラインで利用できます。'],
  waiting: [
    'An update is ready. Close all Formant tabs and reopen the studio.',
    '更新の準備ができました。Formant のタブをすべて閉じてから開き直してください。',
  ],
  failed: [
    'Offline installation failed. Check storage space and reload while online.',
    'オフライン保存に失敗しました。空き容量を確認し、オンラインで再読み込みしてください。',
  ],
  updateFailed: [
    'Your current version is available offline. The update failed. Reload while online to retry.',
    '現在のバージョンはオフラインで利用できます。更新に失敗したため、オンラインで再読み込みしてください。',
  ],
  unsupported: [
    'This browser cannot install the offline app.',
    'このブラウザではオフライン用に保存できません。',
  ],
}
export function OfflineStatus({ lang }: { lang: 'en' | 'ja' }) {
  const state = useSyncExternalStore(subscribeOffline, getOfflineState)
  return (
    <p className="storage-info" role="status" data-offline-state={state}>
      {labels[state][lang === 'ja' ? 1 : 0]}
    </p>
  )
}

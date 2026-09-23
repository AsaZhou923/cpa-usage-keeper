import { useCallback, useState } from 'react';
import {
  AuthFileCredentialsSection,
  CredentialProviderFilterBar,
  useCredentialsTabData,
} from '@/components/usage/credentials';
import { KeyViewerShell } from '@/features/key-viewer/KeyViewerShell';
import type { KeyViewerPath } from '@/features/key-viewer/navigation';
import { fetchKeyOverviewUsageIdentitiesPage, fetchKeyOverviewUsageQuotaCache } from '@/lib/api';
import type { AuthSessionAPIKeySummary } from '@/lib/types';
import styles from '@/features/key-viewer/KeyViewerShell.module.scss';

export interface KeyAuthFilesPageProps {
  apiKey?: AuthSessionAPIKeySummary;
  onNavigate: (path: KeyViewerPath) => void;
  onAuthRequired?: () => void;
}

export function KeyAuthFilesPage({ apiKey, onNavigate, onAuthRequired }: KeyAuthFilesPageProps) {
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const credentialsData = useCredentialsTabData({
    enabledAuthFiles: true,
    enabledAiProviders: false,
    quotaAutoRefreshEnabled: false,
    readOnly: true,
    onAuthRequired,
    fetchUsageIdentitiesPage: fetchKeyOverviewUsageIdentitiesPage,
    fetchUsageQuotaCache: fetchKeyOverviewUsageQuotaCache,
  });

  const handleManualRefresh = useCallback(async () => {
    if (manualRefreshLoading) return;
    setManualRefreshLoading(true);
    try {
      await credentialsData.refresh();
    } finally {
      setManualRefreshLoading(false);
    }
  }, [credentialsData, manualRefreshLoading]);

  return (
    <KeyViewerShell
      activePage="auth-files"
      apiKey={apiKey}
      loading={credentialsData.loading && credentialsData.authFileRows.length === 0}
      onRefresh={() => void handleManualRefresh()}
      refreshing={manualRefreshLoading}
      refreshDisabled={manualRefreshLoading}
      onNavigate={onNavigate}
      onAuthRequired={onAuthRequired}
    >
      {credentialsData.error && <div className={styles.errorBox}>{credentialsData.error}</div>}
      <CredentialProviderFilterBar
        scope="auth-files"
        typeCounts={credentialsData.authFileTypeCounts}
        value={credentialsData.authFileProviderFilter}
        onChange={credentialsData.setAuthFileProviderFilter}
      />
      <div className={styles.credentialsSections}>
        <AuthFileCredentialsSection
          rows={credentialsData.authFileRows}
          total={credentialsData.authFileTotal}
          page={credentialsData.authFilePage}
          totalPages={credentialsData.authFileTotalPages}
          pageSize={credentialsData.authFilePageSize}
          activeOnly={credentialsData.authFileActiveOnly}
          sort={credentialsData.authFileSort}
          loading={credentialsData.loading}
          quotaRefreshing={credentialsData.quotaRefreshing}
          quotaRefreshError={credentialsData.quotaRefreshError}
          quotaAutoRefreshEnabled={false}
          quotaInspectionStatus={credentialsData.quotaInspectionStatus}
          quotaInspectionLoading={credentialsData.quotaInspectionLoading}
          quotaInspectionStarting={credentialsData.quotaInspectionStarting}
          quotaInspectionError={credentialsData.quotaInspectionError}
          readOnly
          onPageChange={credentialsData.setAuthFilePage}
          onPageSizeChange={credentialsData.setAuthFilePageSize}
          onActiveOnlyChange={credentialsData.setAuthFileActiveOnly}
          onSortChange={credentialsData.setAuthFileSort}
          onRefreshQuota={credentialsData.refreshQuotaForCurrentAuthFilePage}
          onRefreshQuotaForAuthIndex={credentialsData.refreshQuotaForAuthIndex}
          onResetQuotaForAuthIndex={credentialsData.resetQuotaForAuthIndex}
          onRefreshInspectionStatus={credentialsData.refreshQuotaInspectionStatus}
          onStartInspection={credentialsData.startQuotaInspection}
        />
      </div>
    </KeyViewerShell>
  );
}

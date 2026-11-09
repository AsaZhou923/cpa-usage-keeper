import { useCallback, useState } from 'react';
import {
  CredentialsSection,
  CredentialProviderFilterBar,
  useCredentialsTabData,
} from '@/components/usage/credentials';
import { KeyViewerShell } from '@/features/key-viewer/KeyViewerShell';
import type { KeyViewerPath } from '@/features/key-viewer/navigation';
import { fetchKeyOverviewUsageIdentitiesPage, fetchKeyOverviewUsageQuotaCache } from '@/lib/api';
import type { AuthSessionAPIKeySummary } from '@/lib/types';
import { MONITORING_TIME_ZONE } from '@/utils/time';
import styles from '@/features/key-viewer/KeyViewerShell.module.scss';

export interface KeyAuthFilesPageProps {
  apiKey?: AuthSessionAPIKeySummary;
  onNavigate: (path: KeyViewerPath) => void;
  onAuthRequired?: () => void;
}

export function KeyAuthFilesPage({ apiKey, onNavigate, onAuthRequired }: KeyAuthFilesPageProps) {
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const credentialsData = useCredentialsTabData({
    enabledCredentials: true,
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
      loading={credentialsData.loading && credentialsData.credentialRows.length === 0}
      onRefresh={() => void handleManualRefresh()}
      refreshing={manualRefreshLoading}
      refreshDisabled={manualRefreshLoading}
      onNavigate={onNavigate}
      onAuthRequired={onAuthRequired}
    >
      {credentialsData.error && <div className={styles.errorBox}>{credentialsData.error}</div>}
      <CredentialProviderFilterBar
        scope="credentials"
        typeCounts={credentialsData.credentialTypeCounts}
        value={credentialsData.credentialProviderFilter}
        onChange={credentialsData.setCredentialProviderFilter}
      />
      <div className={styles.credentialsSections}>
        <CredentialsSection
          timeZone={MONITORING_TIME_ZONE}
          rows={credentialsData.credentialRows}
          total={credentialsData.credentialTotal}
          page={credentialsData.credentialPage}
          totalPages={credentialsData.credentialTotalPages}
          pageSize={credentialsData.credentialPageSize}
          activeOnly={credentialsData.credentialActiveOnly}
          sort={credentialsData.credentialSort}
          loading={credentialsData.loading}
          quotaRefreshing={credentialsData.quotaRefreshing}
          quotaRefreshError={credentialsData.quotaRefreshError}
          quotaAutoRefreshEnabled={false}
          quotaInspectionStatus={credentialsData.quotaInspectionStatus}
          quotaInspectionLoading={credentialsData.quotaInspectionLoading}
          quotaInspectionStarting={credentialsData.quotaInspectionStarting}
          quotaInspectionError={credentialsData.quotaInspectionError}
          readOnly
          onPageChange={credentialsData.setCredentialPage}
          onPageSizeChange={credentialsData.setCredentialPageSize}
          onActiveOnlyChange={credentialsData.setCredentialActiveOnly}
          onSortChange={credentialsData.setCredentialSort}
          onRefreshQuota={credentialsData.refreshQuotaForCurrentCredentialPage}
          onRefreshQuotaForAuthIndex={credentialsData.refreshQuotaForAuthIndex}
          onResetQuotaForAuthIndex={credentialsData.resetQuotaForAuthIndex}
          onRefreshInspectionStatus={credentialsData.refreshQuotaInspectionStatus}
          onStartInspection={credentialsData.startQuotaInspection}
        />
      </div>
    </KeyViewerShell>
  );
}

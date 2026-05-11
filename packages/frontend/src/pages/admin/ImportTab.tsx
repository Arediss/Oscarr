import { useTranslation } from 'react-i18next';
import { AdminTabLayout } from './AdminTabLayout';
import { ImportFlow } from './ImportFlow';

export function ImportTab() {
  const { t } = useTranslation();
  return (
    <AdminTabLayout title={t('admin.import.title')}>
      <ImportFlow />
    </AdminTabLayout>
  );
}

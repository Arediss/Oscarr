import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { startMediaReturnTransition, type MediaReturnOrigin } from '@/utils/mediaTransition';
import './media-transition.css';

/** The same return action stays available while the detail module or its data is loading. */
export default function MediaBackButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  return <button onClick={event => {
    const origin: MediaReturnOrigin | undefined = location.state?.__mediaReturn;
    startMediaReturnTransition(location.pathname, origin, event.currentTarget.getBoundingClientRect(), () => { void navigate(-1); });
  }} aria-label={t('common.back')} className="absolute top-20 left-4 sm:left-8 z-20 p-2 glass rounded-xl hover:bg-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-ndp-accent">
    <ArrowLeft className="w-5 h-5 text-white" />
  </button>;
}

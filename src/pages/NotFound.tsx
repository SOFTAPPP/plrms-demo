import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '../components/ui/core';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <EmptyState icon={<Compass className="h-5 w-5" />} title="This page is off the haul road" message="The address does not match any screen in STRATA."
        action={<Button variant="primary" onClick={() => navigate('/')}>Back to Command</Button>} />
    </div>
  );
}

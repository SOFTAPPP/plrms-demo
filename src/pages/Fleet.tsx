import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarClock, ClipboardList, Route, Truck, Users } from 'lucide-react';
import { Tabs } from '../components/ui/tabs';
import { PageHeader } from '../components/ui/core';
import { MachinesTab } from './fleet/Machines';
import { DispatchTab } from './fleet/Dispatch';
import { CrewsTab } from './fleet/Crews';
import { MaintenanceTab } from './fleet/Maintenance';
import { DowntimeTab } from './fleet/Downtime';
import { useLive } from '../lib/live';

const TABS = ['machines', 'dispatch', 'operators', 'maintenance', 'downtime'] as const;
type Tab = (typeof TABS)[number];

export default function Fleet() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const seg = pathname.split('/')[2] as Tab | undefined;
  const tab: Tab = seg && TABS.includes(seg) ? seg : 'machines';
  const count = useLive((s) => s.ids.length);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Fleet management" subtitle={`${count} machines on site · live status, dispatch, crews, maintenance and downtime`} icon={<Truck className="h-5 w-5" />} />
      <Tabs id="fleet" value={tab} onChange={(t) => navigate(t === 'machines' ? '/fleet' : `/fleet/${t}`)} items={[
        { value: 'machines', label: 'Machines', icon: <Truck className="h-4 w-4" /> },
        { value: 'dispatch', label: 'Dispatch', icon: <Route className="h-4 w-4" /> },
        { value: 'operators', label: 'Crews & shifts', icon: <Users className="h-4 w-4" /> },
        { value: 'maintenance', label: 'Maintenance', icon: <CalendarClock className="h-4 w-4" /> },
        { value: 'downtime', label: 'Downtime', icon: <ClipboardList className="h-4 w-4" /> },
      ]} />
      {tab === 'machines' && <MachinesTab />}
      {tab === 'dispatch' && <DispatchTab />}
      {tab === 'operators' && <CrewsTab />}
      {tab === 'maintenance' && <MaintenanceTab />}
      {tab === 'downtime' && <DowntimeTab />}
    </div>
  );
}

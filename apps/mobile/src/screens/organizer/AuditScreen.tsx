import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getOrgScanAudit, type OrgScanAudit, type OrgScanAuditRow } from '../../api/organizer';
import { trackProductEvent } from '../../lib/productAnalytics';
import { useZ } from '../../theme';

type Filter = 'all' | 'ok' | 'bad';

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All gates' },
  { key: 'ok', label: 'Admitted' },
  { key: 'bad', label: 'Revoked' },
];

const EMPTY_AUDIT: OrgScanAudit = {
  totals: { issued: 0, scanned: 0, wristband_issued: 0, used: 0, revoked: 0 },
  rows: [],
};

function rowOk(row: OrgScanAuditRow) {
  return row.state === 'scanned' || row.state === 'wristband_issued' || row.state === 'used';
}

function stateLabel(state: string) {
  if (state === 'scanned') return 'SCANNED';
  if (state === 'wristband_issued') return 'CONFIRMED';
  if (state === 'used') return 'USED';
  if (state === 'revoked') return 'REVOKED';
  return state.toUpperCase();
}

function displayTime(row: OrgScanAuditRow) {
  const raw = row.confirmedAt || row.scannedAt;
  if (!raw) return '--:--';
  return new Date(raw).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AuditScreen() {
  const z = useZ();
  const insets = useSafeAreaInsets();
  const [audit, setAudit] = useState<OrgScanAudit>(EMPTY_AUDIT);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const loadAudit = useCallback(() => {
    let alive = true;
    setRefreshing(true);
    getOrgScanAudit()
      .then((next) => {
        if (!alive) return;
        setAudit(next);
        trackProductEvent('mobile_organizer_scan_audit_loaded', {
          role: 'organizer',
          count: next.rows.length,
          status: 'loaded',
        });
        setLoadError(null);
      })
      .catch((e: any) => {
        if (alive) setLoadError(e?.message ?? 'Could not load scan audit.');
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const cleanup = loadAudit();
    return cleanup;
  }, [loadAudit]);

  useFocusEffect(
    useCallback(() => {
      const cleanup = loadAudit();
      return cleanup;
    }, [loadAudit]),
  );

  const shown = useMemo(
    () => audit.rows.filter((e) => filter === 'all' || (filter === 'ok') === rowOk(e)),
    [audit.rows, filter],
  );
  const admitted = audit.totals.scanned + audit.totals.wristband_issued + audit.totals.used;

  return (
    <View style={{ flex: 1, backgroundColor: z.bg, paddingTop: insets.top + 8, paddingHorizontal: 20 }}>
      <Text style={{ color: z.bone, fontSize: 24, fontWeight: '900', marginBottom: 12 }}>Scan audit</Text>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 12 }}>
          <Text style={{ color: z.mut2, fontSize: 10, fontWeight: '700' }}>ADMITTED</Text>
          <Text style={{ color: '#4fd699', fontSize: 24, fontWeight: '900', marginTop: 5 }}>{admitted.toLocaleString()}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 14, padding: 12 }}>
          <Text style={{ color: z.mut2, fontSize: 10, fontWeight: '700' }}>REVOKED</Text>
          <Text style={{ color: '#ff8b84', fontSize: 24, fontWeight: '900', marginTop: 5 }}>{audit.totals.revoked.toLocaleString()}</Text>
        </View>
      </View>

      {loadError ? (
        <View style={{ borderColor: z.orange + '66', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12, backgroundColor: z.orange + '12' }}>
          <Text style={{ color: z.orangeSoft, fontSize: 12 }}>{loadError}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        {CHIPS.map((c) => {
          const on = filter === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setFilter(c.key)}
              style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 100, borderColor: on ? z.bone : z.line, borderWidth: 1, backgroundColor: on ? z.bone : 'transparent' }}
            >
              <Text style={{ color: on ? z.bg : z.mut, fontWeight: '600', fontSize: 12 }}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(e) => e.credentialId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadAudit(); }} tintColor={z.ultraSoft} />}
        ListEmptyComponent={
          <View style={{ backgroundColor: z.panel, borderColor: z.line, borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 8 }}>
            <Text style={{ color: z.mut, fontSize: 13 }}>{refreshing ? 'Loading scan audit…' : 'No scan activity yet.'}</Text>
          </View>
        }
        renderItem={({ item: e }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomColor: z.line2, borderBottomWidth: 1 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: rowOk(e) ? z.green : z.red }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: z.bone, fontWeight: '700' }}>{e.publicRef}</Text>
              <Text style={{ color: z.mut2, fontSize: 11, marginTop: 3 }}>{e.eventName} · {e.scannedByName || e.confirmedByName || 'Scanner'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: rowOk(e) ? '#4fd699' : '#ff8b84', fontSize: 10, fontWeight: '700' }}>{stateLabel(e.state)}</Text>
              <Text style={{ color: z.mut2, fontSize: 10, marginTop: 3 }}>{displayTime(e)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

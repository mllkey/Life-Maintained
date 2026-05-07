# LifeMaintained — Pass D Findings

**Audit:** Paid-gate timing + paid-surface UX hierarchy
**Generated:** May 6, 2026
**HEAD:** 6a7fc640830a90adedaee5744150222a2959dbf5
**Scope:** app/, lib/, components/ (excludes supabase/functions/)
**Type:** READ-ONLY DISCOVERY — no code changes, no commits

---

## Patterns audited

**Pattern A — Late gate timing.** Paid-tier or quota check that fires after the user has done meaningful work (image picked, audio recorded, AI started). Correct pattern: gate on first tap, before any work begins.

**Pattern B — Underbuilt paid surface.** Paid-action surface that is functional but not at the LogSheet/VoiceOrb bar. Markers: missing per-unit math, missing value-prop framing, modal-pretending-to-be-a-sheet, generic icons, no haptic choreography, flat hierarchy on tier/option cards.

**Design judgment rule.** If a surface is conceptually wrong, recommend rip-out or defer. If directionally right but underbuilt, recommend focused upgrade. Do not propose broad rewrites unless local changes can't reach the bar.

**Product call reminder.** Do NOT resurrect the global offline banner — G6.1 deliberately removed it. Offline handling belongs in paid-action inline error states.

---


## Pattern A — Gate timing audit

### A1. All tier/quota gate call sites

```
# Grep: tier reads, trial/expiration logic, paywall mounts, scan pack mounts, pivot tables
app/terms-of-service.tsx:11:    body: "LifeMaintained provides tools for tracking and managing maintenance across vehicles, property, and personal health-related activities. Features may include reminders, recordkeeping, cost estimates, and AI-assisted insights.",
components/ReceiptScanButton.tsx:20:  onScanLimitReached?: () => void;
components/ReceiptScanButton.tsx:21:  /** Paid user hits cap — caller typically opens ScanPackModal. */
components/ReceiptScanButton.tsx:25:export default function ReceiptScanButton({ assetType, assetId, onScanComplete, onScanLimitReached, onPaidUserAtCap }: Props) {
components/ReceiptScanButton.tsx:81:          const handler = onPaidUserAtCap ?? onScanLimitReached;
components/ScanPackModal.tsx:32:interface ScanPackModalProps {
components/ScanPackModal.tsx:38:export default function ScanPackModal({ visible, onClose, onSuccess }: ScanPackModalProps) {
components/Paywall.tsx:46:      "3 vehicles + 2 properties",
components/Paywall.tsx:63:      "6 vehicles + 5 properties",
components/Paywall.tsx:79:      "Unlimited vehicles & properties",
components/Paywall.tsx:132:  const latestProfileTierRef = useRef<string | null>(profile?.subscription_tier ?? null);
components/Paywall.tsx:134:    latestProfileTierRef.current = profile?.subscription_tier ?? null;
components/Paywall.tsx:135:  }, [profile?.subscription_tier]);
components/Paywall.tsx:654:                {profile?.subscription_tier === "trial" && profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date()
app/edit-vehicle.tsx:28:type VehicleUpdate = Database["public"]["Tables"]["vehicles"]["Update"];
app/edit-vehicle.tsx:67:      .from("vehicles")
app/edit-vehicle.tsx:137:      const { error } = await supabase.from("vehicles").update(updates).eq("id", vehicleId!);
app/edit-vehicle.tsx:140:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
components/LogSheet.tsx:256:      const { data } = await supabase.from("vehicles").select("*").eq("id", item.asset_id!).single();
components/LogSheet.tsx:350:      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
components/LogSheet.tsx:352:        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
components/LogSheet.tsx:355:        queryClient.invalidateQueries({ queryKey: ["properties"] });
components/LogSheet.tsx:675:                message="Tap the microphone, say what you did, and we'll log it automatically. Works for vehicles, home, and health."
components/LogSheet.tsx:743:                  message="Tap the microphone, say what you did, and we'll log it automatically. Works for vehicles, home, and health."
app/update-mileage/[vehicleId].tsx:36:      const { data } = await supabase.from("vehicles").select("*").eq("id", vehicleId!).single();
app/update-mileage/[vehicleId].tsx:62:        const { error: updateErr } = await supabase.from("vehicles").update({ hours: newMileage, updated_at: new Date().toISOString() }).eq("id", vehicleId);
app/update-mileage/[vehicleId].tsx:65:        const { error: updateErr } = await supabase.from("vehicles").update({ mileage: newMileage, last_mileage_update: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", vehicleId);
app/update-mileage/[vehicleId].tsx:80:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/update-mileage/[vehicleId].tsx:81:      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
components/Tooltip.tsx:14:  VEHICLES_FIRST_VISIT: "vehicles_first_visit",
lib/vehicleUsageHelper.ts:38:      .from("vehicles")
lib/vehicleUsageHelper.ts:58:      .from("vehicles")
lib/notificationScheduler.ts:183:    const [vehiclesRes, propertiesRes, medicationsRes] = await Promise.all([
lib/notificationScheduler.ts:185:        .from("vehicles")
lib/notificationScheduler.ts:189:        .from("properties")
lib/notificationScheduler.ts:194:        .select("id, name, reminder_time, reminders_enabled, family_member_id, family_members(name)")
lib/notificationScheduler.ts:199:    const vehicles = vehiclesRes.data ?? [];
lib/notificationScheduler.ts:200:    const properties = propertiesRes.data ?? [];
lib/notificationScheduler.ts:202:    const vehicleIds = vehicles.map(v => v.id);
lib/notificationScheduler.ts:203:    const propertyIds = properties.map(p => p.id);
lib/notificationScheduler.ts:224:    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
lib/notificationScheduler.ts:225:    const propertyMap = new Map(properties.map(p => [p.id, p]));
lib/notificationScheduler.ts:324:      // Check miles (use estimated mileage for pure mileage-tracked vehicles)
lib/notificationScheduler.ts:402:        .select("appointment_type, next_due_date, family_member_id, family_members(name)")
lib/notificationScheduler.ts:410:        const memberName = (appt as any).family_members?.name;
lib/notificationScheduler.ts:511:      const memberName = (med as any).family_members?.name;
app/(tabs)/vehicles.tsx:75:  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/vehicles.tsx:77:  const { data: vehicles, isLoading, refetch } = useQuery({
app/(tabs)/vehicles.tsx:78:    queryKey: ["vehicles", user?.id],
app/(tabs)/vehicles.tsx:82:        .from("vehicles")
app/(tabs)/vehicles.tsx:92:    queryKey: ["vehicle_task_data", user?.id, vehicles?.map(v => v.id).join(",")],
app/(tabs)/vehicles.tsx:94:      if (!user || !vehicles?.length) return {};
app/(tabs)/vehicles.tsx:95:      const ids = vehicles.map(v => v.id);
app/(tabs)/vehicles.tsx:120:    enabled: !!(user && vehicles?.length),
app/(tabs)/vehicles.tsx:164:        ) : vehicles?.length === 0 ? (
app/(tabs)/vehicles.tsx:167:          vehicles?.map((v, idx) => {
app/(tabs)/vehicles.tsx:230:                    setShowPaywall(true);
app/(tabs)/vehicles.tsx:276:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/vehicles.tsx:280:          subtitle="Adding more vehicles requires Pro."
app/(tabs)/vehicles.tsx:281:          onDismiss={() => setShowPaywall(false)}
app/(tabs)/vehicles.tsx:314:      <Text style={styles.emptyTitle}>No vehicles yet</Text>
app/(tabs)/home-tab.tsx:76:  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/home-tab.tsx:78:  const { data: properties, isLoading, refetch } = useQuery({
app/(tabs)/home-tab.tsx:79:    queryKey: ["properties", user?.id],
app/(tabs)/home-tab.tsx:83:        .from("properties")
app/(tabs)/home-tab.tsx:93:    queryKey: ["property_task_counts", user?.id, properties?.map(p => p.id).join(",")],
app/(tabs)/home-tab.tsx:95:      if (!user || !properties?.length) return {};
app/(tabs)/home-tab.tsx:96:      const ids = properties.map(p => p.id);
app/(tabs)/home-tab.tsx:112:    enabled: !!(user && properties?.length),
app/(tabs)/home-tab.tsx:149:        ) : properties?.length === 0 ? (
app/(tabs)/home-tab.tsx:152:          properties?.map((p, idx) => {
app/(tabs)/home-tab.tsx:182:                    setShowPaywall(true);
app/(tabs)/home-tab.tsx:208:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/home-tab.tsx:212:          subtitle="Adding more properties requires Pro."
app/(tabs)/home-tab.tsx:213:          onDismiss={() => setShowPaywall(false)}
app/(tabs)/home-tab.tsx:247:      <Text style={styles.emptyTitle}>No properties yet</Text>
lib/supabase-types.ts:83:      family_members: {
lib/supabase-types.ts:188:            referencedRelation: "family_members"
lib/supabase-types.ts:319:            referencedRelation: "vehicles"
lib/supabase-types.ts:387:            referencedRelation: "properties"
lib/supabase-types.ts:394:            referencedRelation: "vehicles"
lib/supabase-types.ts:557:            referencedRelation: "vehicles"
lib/supabase-types.ts:598:            referencedRelation: "family_members"
lib/supabase-types.ts:745:          monthly_scan_count: number
lib/supabase-types.ts:752:          scan_count_reset_at: string | null
lib/supabase-types.ts:755:          subscription_expires_at: string | null
lib/supabase-types.ts:758:          subscription_tier: string
lib/supabase-types.ts:760:          trial_expires_at: string | null
lib/supabase-types.ts:774:          monthly_scan_count?: number
lib/supabase-types.ts:781:          scan_count_reset_at?: string | null
lib/supabase-types.ts:784:          subscription_expires_at?: string | null
lib/supabase-types.ts:787:          subscription_tier?: string
lib/supabase-types.ts:789:          trial_expires_at?: string | null
lib/supabase-types.ts:803:          monthly_scan_count?: number
lib/supabase-types.ts:810:          scan_count_reset_at?: string | null
lib/supabase-types.ts:813:          subscription_expires_at?: string | null
lib/supabase-types.ts:816:          subscription_tier?: string
lib/supabase-types.ts:818:          trial_expires_at?: string | null
lib/supabase-types.ts:892:      properties: {
lib/supabase-types.ts:1006:            referencedRelation: "properties"
lib/supabase-types.ts:1101:            referencedRelation: "scan_credits"
lib/supabase-types.ts:1213:      scan_credits: {
lib/supabase-types.ts:1372:          muted_properties: string[] | null
lib/supabase-types.ts:1373:          muted_vehicles: string[] | null
lib/supabase-types.ts:1391:          muted_properties?: string[] | null
lib/supabase-types.ts:1392:          muted_vehicles?: string[] | null
lib/supabase-types.ts:1410:          muted_properties?: string[] | null
lib/supabase-types.ts:1411:          muted_vehicles?: string[] | null
lib/supabase-types.ts:1615:            referencedRelation: "vehicles"
lib/supabase-types.ts:1653:            referencedRelation: "vehicles"
lib/supabase-types.ts:1736:            referencedRelation: "vehicles"
lib/supabase-types.ts:1771:            referencedRelation: "vehicles"
lib/supabase-types.ts:1809:            referencedRelation: "vehicles"
lib/supabase-types.ts:1814:      vehicles: {
app/add-appointment.tsx:69:    queryKey: ["family_members", user?.id],
app/add-appointment.tsx:72:      const { data } = await supabase.from("family_members").select("*").eq("user_id", user.id).order("name");
app/add-appointment.tsx:87:        .from("family_members")
app/add-appointment.tsx:109:        .from("family_members")
app/(tabs)/settings.tsx:153:    queryKey: ["settings_pred_vehicles", user?.id],
app/(tabs)/settings.tsx:157:        .from("vehicles")
app/(tabs)/settings.tsx:377:            Alert.alert("Are you absolutely sure?", "All vehicles, properties, health records, and history will be deleted.", [
app/(tabs)/settings.tsx:421:    profile?.subscription_tier === "trial" ||
app/(tabs)/settings.tsx:422:    (!!profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date());
app/(tabs)/settings.tsx:423:  const trialDaysLeft = profile?.trial_expires_at
app/(tabs)/settings.tsx:424:    ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
app/(tabs)/settings.tsx:426:  const isPremium = hasPersonalOrAbove(profile);
app/(tabs)/settings.tsx:427:  const userIsFreeTier = !userIsInTrial && !isPremium;
app/(tabs)/settings.tsx:429:  const expiryDate = profile?.subscription_expires_at ? parseISO(profile.subscription_expires_at) : null;
app/(tabs)/settings.tsx:481:                <Text style={styles.bannerSub}>Upgrade to unlock vehicles, scans & exports</Text>
app/(tabs)/settings.tsx:492:          {isPremium && !userIsInTrial && (
app/(tabs)/settings.tsx:726:            {isPremium && !userIsInTrial && !!profile?.revenuecat_customer_id && (
app/(tabs)/_layout.tsx:22:      <NativeTabs.Trigger name="vehicles">
app/(tabs)/_layout.tsx:87:        name="vehicles"
app/vehicle/[id].tsx:131:  const [showPaywall, setShowPaywall] = useState(false);
app/vehicle/[id].tsx:171:      const { data } = await supabase.from("vehicles").select("*").eq("id", id).maybeSingle();
app/vehicle/[id].tsx:761:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/vehicle/[id].tsx:847:      await supabase.from("vehicles").update({ photo_url: publicUrl }).eq("id", id!);
app/vehicle/[id].tsx:849:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/vehicle/[id].tsx:863:      await supabase.from("vehicles").update({ photo_url: null }).eq("id", id!);
app/vehicle/[id].tsx:865:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/vehicle/[id].tsx:980:            queryClient.setQueryData(["vehicles", userId], (old: any) => {
app/vehicle/[id].tsx:999:            // Navigate safely to vehicles list
app/vehicle/[id].tsx:1003:              router.replace("/(tabs)/vehicles");
app/vehicle/[id].tsx:1024:                await supabase.from("vehicles").delete().eq("id", vehicleId);
app/vehicle/[id].tsx:1026:                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/vehicle/[id].tsx:1033:                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/vehicle/[id].tsx:1044:      setShowPaywall(true);
app/vehicle/[id].tsx:1696:      {showPaywall && (
app/vehicle/[id].tsx:1697:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/vehicle/[id].tsx:1701:            onDismiss={() => setShowPaywall(false)}
app/vehicle/[id].tsx:2410:  vehicles: { make: string | null; model: string | null; year: number | null; nickname: string | null } | null;
app/vehicle/[id].tsx:2421:  const v = row.vehicles;
app/vehicle/[id].tsx:2450:        .select("*, vehicles!inner(make, model, year, nickname)")
app/(tabs)/health.tsx:86:  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/health.tsx:101:        .select("*, family_members(name, relationship, member_type)")
app/(tabs)/health.tsx:115:        .select("*, family_members(name)")
app/(tabs)/health.tsx:124:    queryKey: ["family_members", user?.id],
app/(tabs)/health.tsx:128:        .from("family_members")
app/(tabs)/health.tsx:157:        .from("family_members")
app/(tabs)/health.tsx:391:      const memberName = (overdue as any).family_members?.name;
app/(tabs)/health.tsx:397:      const memberName = (dueSoon as any).family_members?.name;
app/(tabs)/health.tsx:415:    setShowPaywall(true);
app/(tabs)/health.tsx:469:      const memberName = (a as any).family_members?.name ?? "You";
app/(tabs)/health.tsx:484:      const memberName = (m as any).family_members?.name ?? "You";
app/(tabs)/health.tsx:603:                {profile?.subscription_tier === "free" && (
app/(tabs)/health.tsx:729:                        if ((m as any).family_members?.name) metaParts.push((m as any).family_members.name);
app/(tabs)/health.tsx:771:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/health.tsx:776:          onDismiss={() => setShowPaywall(false)}
app/(tabs)/health.tsx:917:  const member = (appointment as any).family_members;
app/add-family-member.tsx:45:  const [showPaywall, setShowPaywall] = useState(false);
app/add-family-member.tsx:64:        .from("family_members")
app/add-family-member.tsx:70:        setShowPaywall(true);
app/add-family-member.tsx:74:        setShowPaywall(true);
app/add-family-member.tsx:87:    const { data: newMember, error: err } = await supabase.from("family_members").insert({
app/add-family-member.tsx:100:      queryClient.invalidateQueries({ queryKey: ["family_members"] });
app/add-family-member.tsx:202:      {showPaywall && (
app/add-family-member.tsx:203:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-family-member.tsx:207:            onDismiss={() => setShowPaywall(false)}
lib/vehicleTypes.ts:5: * These sets are used as DEFAULT HEURISTICS — the DB column `vehicles.tracking_mode`
lib/vehicleTypes.ts:52: * Only used as a fallback when `vehicles.tracking_mode` is NULL.
app/(tabs)/index.tsx:48:  vehicles: { color: Colors.blue, muted: Colors.blueMuted, icon: "car" as const, label: "Vehicles", desc: "Cars, trucks, motorcycles & more", addRoute: "/add-vehicle" as any, tab: "/(tabs)/vehicles" as any },
app/(tabs)/index.tsx:49:  properties: { color: Colors.good, muted: Colors.goodMuted, icon: "home" as const, label: "Properties", desc: "Home, HVAC, roof & appliances", addRoute: "/add-property" as any, tab: "/(tabs)/home-tab" as any },
app/(tabs)/index.tsx:59:  category: "vehicles" | "properties" | "health";
app/(tabs)/index.tsx:139:  if (category === "vehicles") return "Vehicle";
app/(tabs)/index.tsx:140:  if (category === "properties") return "Home";
app/(tabs)/index.tsx:219:      if (!user) return { vehicles: 0, properties: 0, health: 0 };
app/(tabs)/index.tsx:221:        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
app/(tabs)/index.tsx:222:        supabase.from("properties").select("id", { count: "exact", head: true }).eq("user_id", user.id),
app/(tabs)/index.tsx:226:        vehicles: veh.count ?? 0,
app/(tabs)/index.tsx:227:        properties: prop.count ?? 0,
app/(tabs)/index.tsx:240:        supabase.from("user_vehicle_maintenance_tasks").select("*, vehicles(make, model, nickname, mileage, hours, tracking_mode, vehicle_type)").eq("user_id", user.id),
app/(tabs)/index.tsx:241:        supabase.from("property_maintenance_tasks").select("*, properties!inner(address, nickname)").eq("properties.user_id", user.id),
app/(tabs)/index.tsx:245:        const v = (t as any).vehicles;
app/(tabs)/index.tsx:256:          category: "vehicles",
app/(tabs)/index.tsx:261:        const p = (t as any).properties;
app/(tabs)/index.tsx:265:          items.push({ id: t.id, title: t.task, subtitle: p.nickname ?? p.address ?? "Property", dueDate: t.next_due_date, status, category: "properties", entityId: t.property_id });
app/(tabs)/index.tsx:286:      const { data: veh } = await supabase.from("vehicles").select("id").eq("user_id", user.id);
app/(tabs)/index.tsx:308:    queryKey: ["mileage_vehicles", user?.id],
app/(tabs)/index.tsx:312:        .from("vehicles")
app/(tabs)/index.tsx:332:    queryKey: ["family_members_count", user?.id],
app/(tabs)/index.tsx:335:      const { data } = await supabase.from("family_members").select("id").eq("user_id", user.id);
app/(tabs)/index.tsx:346:        supabase.from("user_vehicle_maintenance_tasks").select("vehicles!inner(user_id)", { count: "exact", head: true }).eq("vehicles.user_id", user.id),
app/(tabs)/index.tsx:347:        supabase.from("property_maintenance_tasks").select("properties!inner(user_id)", { count: "exact", head: true }).eq("properties.user_id", user.id),
app/(tabs)/index.tsx:386:  const isNewUser = !isLoading && !hasDashboardError && counts != null && counts.vehicles === 0 && counts.properties === 0 && counts.health === 0;
app/(tabs)/index.tsx:417:                {counts?.vehicles ?? 0} vehicle{(counts?.vehicles ?? 0) !== 1 ? "s" : ""}{" · "}{counts?.properties ?? 0} propert{(counts?.properties ?? 0) !== 1 ? "ies" : "y"}{" · "}{counts?.health ?? 0} health item{(counts?.health ?? 0) !== 1 ? "s" : ""}
app/(tabs)/index.tsx:476:              message="This is your command center. Everything that needs attention across vehicles, home, and health shows up here."
app/(tabs)/index.tsx:504:              <QuickMileageCard vehicles={mileageVehicles!} userId={user!.id} />
app/(tabs)/index.tsx:669:function QuickMileageCard({ vehicles, userId }: { vehicles: MileageVehicle[]; userId: string }) {
app/(tabs)/index.tsx:682:  const staleCount = vehicles.filter(isStale).length;
app/(tabs)/index.tsx:685:  const sortedVehicles = [...vehicles].sort((a, b) => {
app/(tabs)/index.tsx:740:        const { error: updateErr } = await supabase.from("vehicles").update({ hours: newH, updated_at: now }).eq("id", v.id);
app/(tabs)/index.tsx:744:        const { error: updateErr } = await supabase.from("vehicles").update({ mileage: newM, last_mileage_update: now, updated_at: now }).eq("id", v.id);
app/(tabs)/index.tsx:750:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/(tabs)/index.tsx:752:      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
app/(tabs)/index.tsx:769:  const anyHours = vehicles.some(v => isHoursTrackedMode(resolveTrackingMode(v)));
app/(tabs)/index.tsx:770:  const anyMiles = vehicles.some(v => isMileageTrackedMode(resolveTrackingMode(v)));
app/(tabs)/index.tsx:773:  if (vehicles.length === 1) {
app/(tabs)/index.tsx:774:    const v = vehicles[0];
app/(tabs)/index.tsx:899:    if (item.category === "vehicles") {
app/(tabs)/index.tsx:902:    } else if (item.category === "properties") {
app/(tabs)/index.tsx:973:    if (item.category === "vehicles") router.push(`/vehicle/${item.entityId}` as any);
app/(tabs)/index.tsx:974:    else if (item.category === "properties") router.push(`/property/${item.entityId}` as any);
app/(tabs)/index.tsx:983:  const firstNavItem = items.find(i => i.category === "vehicles" || i.category === "properties");
app/(tabs)/index.tsx:984:  const seeAllRoute: any = firstNavItem?.category === "vehicles" ? "/(tabs)/vehicles" : "/(tabs)/home-tab";
app/(tabs)/index.tsx:1120:      key: "vehicles" as const,
app/(tabs)/index.tsx:1130:      key: "properties" as const,
lib/subscription.ts:6:  subscription_tier: string | null;
lib/subscription.ts:8:  trial_expires_at: string | null;
lib/subscription.ts:9:  subscription_expires_at: string | null;
lib/subscription.ts:12:  monthly_scan_count: number;
lib/subscription.ts:13:  scan_count_reset_at: string | null;
lib/subscription.ts:19:export function hasActivePremium(profile: Profile | null | undefined): boolean {
lib/subscription.ts:23:      profile.subscription_tier === "trial" &&
lib/subscription.ts:24:      profile.trial_expires_at &&
lib/subscription.ts:25:      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts:29:      PAID_TIERS.includes(profile.subscription_tier ?? "") &&
lib/subscription.ts:30:      profile.subscription_expires_at &&
lib/subscription.ts:31:      new Date(profile.subscription_expires_at) > new Date()
lib/subscription.ts:41:  return hasActivePremium(profile);
lib/subscription.ts:48:      profile.subscription_tier === "trial" &&
lib/subscription.ts:49:      profile.trial_expires_at &&
lib/subscription.ts:50:      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts:53:      ["pro", "business"].includes(profile.subscription_tier ?? "") &&
lib/subscription.ts:54:      profile.subscription_expires_at &&
lib/subscription.ts:55:      new Date(profile.subscription_expires_at) > new Date()
lib/subscription.ts:67:      profile.subscription_tier === "business" &&
lib/subscription.ts:68:      !!profile.subscription_expires_at &&
lib/subscription.ts:69:      new Date(profile.subscription_expires_at) > new Date()
lib/subscription.ts:115:      profile.subscription_tier === "trial" &&
lib/subscription.ts:116:      !!profile.trial_expires_at &&
lib/subscription.ts:117:      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts:125:  return !hasActivePremium(profile);
lib/subscription.ts:130: * Receipt scan enforcement no longer relies on profile.monthly_scan_count.
lib/subscription.ts:133:  return Math.max(0, scanLimit(profile) - ((profile?.monthly_scan_count) ?? 0));
lib/subscription.ts:137:  if (!profile || !isInTrial(profile) || !profile.trial_expires_at) return 0;
lib/subscription.ts:139:    const ms = new Date(profile.trial_expires_at).getTime() - Date.now();
app/add-property.tsx:156:  const [showPaywall, setShowPaywall] = useState(false);
app/add-property.tsx:276:        .from("properties")
app/add-property.tsx:281:        setShowPaywall(true);
app/add-property.tsx:292:    const { data: newProperty, error: err } = await supabase.from("properties").insert({
app/add-property.tsx:312:      // Fire-and-forget: generate AI schedule in background (same pattern as vehicles)
app/add-property.tsx:338:    queryClient.invalidateQueries({ queryKey: ["properties"] });
app/add-property.tsx:339:    queryClient.invalidateQueries({ queryKey: ["properties", user.id] });
app/add-property.tsx:574:      {showPaywall && (
app/add-property.tsx:575:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-property.tsx:578:            subtitle="Upgrade to add more properties"
app/add-property.tsx:579:            onDismiss={() => setShowPaywall(false)}
app/add-medication.tsx:45:    queryKey: ["family_members", user?.id],
app/add-medication.tsx:48:      const { data } = await supabase.from("family_members").select("*").eq("user_id", user.id).order("name");
app/property/[id].tsx:113:      const { data } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
app/property/[id].tsx:370:        await supabase.from("properties").update({ photo_url: publicUrl }).eq("id", id!);
app/property/[id].tsx:385:      await supabase.from("properties").update({ photo_url: null }).eq("id", id!);
app/property/[id].tsx:409:            for (const key of [["properties"], ["properties", userId]] as const) {
app/property/[id].tsx:426:                await supabase.from("properties").delete().eq("id", id!);
app/property/[id].tsx:427:                queryClient.invalidateQueries({ queryKey: ["properties"] });
app/property/[id].tsx:428:                queryClient.invalidateQueries({ queryKey: ["properties", userId] });
app/property/[id].tsx:433:                queryClient.invalidateQueries({ queryKey: ["properties"] });
app/property/[id].tsx:434:                queryClient.invalidateQueries({ queryKey: ["properties", userId] });
app/vehicle-task-history/[vehicleId].tsx:42:        .from("vehicles")
app/(onboarding)/building-plan.tsx:159:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/add-vehicle.tsx:584:      const { data: vehicles } = await supabase
app/add-vehicle.tsx:585:        .from("vehicles")
app/add-vehicle.tsx:589:      return (vehicles ?? []) as { id: string; year: number; make: string; model: string; nickname: string | null }[];
app/add-vehicle.tsx:618:  const [showPaywall, setShowPaywall] = useState(false);
app/add-vehicle.tsx:757:      const nhtsaBase = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodedMake}/modelyear/${yearNum}`;
app/add-vehicle.tsx:860:        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${cleanVin}?format=json`
app/add-vehicle.tsx:973:        .from("vehicles")
app/add-vehicle.tsx:977:        setShowPaywall(true);
app/add-vehicle.tsx:1043:          .from("vehicles")
app/add-vehicle.tsx:1054:          queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/add-vehicle.tsx:1104:        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/add-vehicle.tsx:1106:        queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
app/add-vehicle.tsx:1123:        .from("vehicles")
app/add-vehicle.tsx:1162:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/add-vehicle.tsx:1164:      queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
app/add-vehicle.tsx:2170:      {showPaywall && (
app/add-vehicle.tsx:2171:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-vehicle.tsx:2174:            subtitle="Upgrade to add more vehicles"
app/add-vehicle.tsx:2175:            onDismiss={() => setShowPaywall(false)}
app/add-vehicle.tsx:2358:        Some makes may not have model data for older vehicles. You can always type a custom make.
app/(onboarding)/value-reveal.tsx:65:      const { data: vehicle } = await supabase.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
app/family-member/[id].tsx:52:        .from("family_members")
app/family-member/[id].tsx:152:        await supabase.from("family_members").update({ photo_url: publicUrl }).eq("id", id!);
app/family-member/[id].tsx:166:      await supabase.from("family_members").update({ photo_url: null }).eq("id", id!);
app/family-member/[id].tsx:194:              await supabase.from("family_members").delete().eq("id", id!);
app/family-member/[id].tsx:195:              queryClient.invalidateQueries({ queryKey: ["family_members"] });
app/log-service/[vehicleId].tsx:25:import ScanPackModal from "@/components/ScanPackModal";
app/log-service/[vehicleId].tsx:54:  const [showPaywall, setShowPaywall] = useState(false);
app/log-service/[vehicleId].tsx:55:  const [showScanPackModal, setShowScanPackModal] = useState(false);
app/log-service/[vehicleId].tsx:91:      .from("vehicles")
app/log-service/[vehicleId].tsx:158:            .from("vehicles")
app/log-service/[vehicleId].tsx:165:            .from("properties")
app/log-service/[vehicleId].tsx:357:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
app/log-service/[vehicleId].tsx:358:      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
app/log-service/[vehicleId].tsx:454:                  setShowPaywall(true);
app/log-service/[vehicleId].tsx:469:                onScanLimitReached={() => setShowPaywall(true)}
app/log-service/[vehicleId].tsx:470:                onPaidUserAtCap={() => setShowScanPackModal(true)}
app/log-service/[vehicleId].tsx:692:      {showPaywall && (
app/log-service/[vehicleId].tsx:693:        <Modal visible animationType="slide" onRequestClose={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}>
app/log-service/[vehicleId].tsx:697:            onDismiss={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
app/log-service/[vehicleId].tsx:701:      <ScanPackModal
app/log-service/[vehicleId].tsx:702:        visible={showScanPackModal}
app/log-service/[vehicleId].tsx:703:        onClose={() => setShowScanPackModal(false)}
app/log-service/[vehicleId].tsx:704:        onSuccess={() => setShowScanPackModal(false)}
app/notifications-settings.tsx:37:  const { data: vehicles } = useQuery({
app/notifications-settings.tsx:38:    queryKey: ["vehicles", user?.id],
app/notifications-settings.tsx:41:      const { data } = await supabase.from("vehicles").select("id, make, model, nickname, year").eq("user_id", user.id);
app/notifications-settings.tsx:47:  const { data: properties } = useQuery({
app/notifications-settings.tsx:48:    queryKey: ["properties", user?.id],
app/notifications-settings.tsx:51:      const { data } = await supabase.from("properties").select("id, address, nickname").eq("user_id", user.id);
app/notifications-settings.tsx:340:        {vehicles && vehicles.length > 0 && (
app/notifications-settings.tsx:342:            <Text style={styles.sectionHint}>Muted vehicles won't send any reminders</Text>
app/notifications-settings.tsx:343:            {vehicles.map(v => (
app/notifications-settings.tsx:357:        {properties && properties.length > 0 && (
app/notifications-settings.tsx:359:            <Text style={styles.sectionHint}>Muted properties won't send any reminders</Text>
app/notifications-settings.tsx:360:            {properties.map(p => (
```

### A2. Paid-work entry points

```
components/LogSheet.tsx:15:import { Audio } from "expo-av";
components/LogSheet.tsx:468:  const recordingRef = useRef<Audio.Recording | null>(null);
components/LogSheet.tsx:490:      await rec.stopAndUnloadAsync();
components/LogSheet.tsx:510:      const rec = new Audio.Recording();
components/LogSheet.tsx:512:        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
components/LogSheet.tsx:521:      await rec.startAsync();
components/LogSheet.tsx:537:      await rec.stopAndUnloadAsync();
components/LogSheet.tsx:570:      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
components/LogSheet.tsx:608:      const { data, error } = await supabase.functions.invoke("extract-maintenance-data", {
components/LogSheet.tsx:612:      if (__DEV__) console.log("[extract-maintenance-data] data:", JSON.stringify(data));
components/LogSheet.tsx:613:      if (__DEV__) console.log("[extract-maintenance-data] error:", error);
components/LogSheet.tsx:617:        console.error("[extract-maintenance-data] invoke error:", msg);
components/LogSheet.tsx:624:        console.error("[extract-maintenance-data] function error:", data.error);
components/LogSheet.tsx:641:      console.error("[extract-maintenance-data] caught:", msg);
components/Paywall.tsx:189:      const offerings = await Purchases.getOfferings();
components/Paywall.tsx:217:    // outages. Do not tell the user the purchase failed while purchasePackage
components/Paywall.tsx:235:        message: "This is taking longer than expected. You can leave this screen — if Apple completes the charge, come back and tap Restore Purchases.",
components/Paywall.tsx:276:      const { customerInfo } = await Purchases.purchasePackage(pkg);
components/Paywall.tsx:311:              message: "The purchase went through. Tap Restore Purchases. If it still won't unlock, email support@lifemaintained.com.",
components/Paywall.tsx:359:      const customerInfo = await Purchases.restorePurchases();
components/Paywall.tsx:413:      const { data, error } = await supabase.functions.invoke("apply-promo-code", {
components/ScanPackModal.tsx:56:      const purchaseResult = await Purchases.purchaseProduct(pack.id);
lib/revenuecat.ts:54:  const { data, error } = await supabase.functions.invoke("sync-subscription-from-rc", {
components/ReceiptScanButton.tsx:3:import * as ImagePicker from "expo-image-picker";
components/ReceiptScanButton.tsx:54:        ? await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false })
components/ReceiptScanButton.tsx:55:        : await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ["images"] });
app/add-property.tsx:95:    const { data, error } = await supabase.functions.invoke("places-autocomplete", {
app/add-property.tsx:117:    const { data, error } = await supabase.functions.invoke("places-details", {
app/add-property.tsx:238:        const { data } = await supabase.functions.invoke("property-lookup", {
app/add-property.tsx:315:          const { error: scheduleError } = await supabase.functions.invoke(
app/add-property.tsx:316:            "generate-property-schedule",
app/add-property.tsx:329:            if (httpStatus !== 409) console.warn("[generate-property-schedule] Error:", scheduleError.message);
app/add-property.tsx:333:          console.warn("[generate-property-schedule] Caught:", scheduleErr);
lib/receiptScanner.ts:62:    const { data, error: invokeError } = await supabase.functions.invoke("scan-receipt", {
lib/receiptScanner.ts:73:      console.log("scan-receipt invoke error:", invokeError);
lib/receiptScanner.ts:74:      console.log("scan-receipt invoke data (first 300):", JSON.stringify(data)?.slice(0, 300));
lib/receiptScanner.ts:85:          console.warn("scan-receipt error response:", msg);
lib/receiptScanner.ts:97:          console.error("scan-receipt non-JSON error body:", preview);
lib/receiptScanner.ts:103:      console.warn("scan-receipt invoke error:", invokeError.message);
app/_layout.tsx:100:        await Purchases.logIn(userId);
app/_layout.tsx:141:        Purchases.addCustomerInfoUpdateListener(handler);
app/_layout.tsx:144:            Purchases.removeCustomerInfoUpdateListener(handler);
app/_layout.tsx:260:            Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
app/_layout.tsx:262:            Purchases.setLogLevel(Purchases.LOG_LEVEL.WARN);
app/_layout.tsx:264:          Purchases.configure({ apiKey });
app/property-task-history/[propertyId].tsx:79:      const { data, error } = await supabase.storage
app/family-member/[id].tsx:13:import * as ImagePicker from "expo-image-picker";
app/family-member/[id].tsx:136:        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] })
app/family-member/[id].tsx:137:        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
app/family-member/[id].tsx:142:        const response = await fetch(uri);
app/family-member/[id].tsx:146:        const { error: uploadError } = await supabase.storage
app/family-member/[id].tsx:148:          .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/family-member/[id].tsx:150:        const { data: urlData } = supabase.storage.from("profile-photos").getPublicUrl(storagePath);
app/family-member/[id].tsx:168:      await supabase.storage.from("profile-photos").remove([storagePath]);
app/(tabs)/health.tsx:200:  function refetch() {
app/add-family-member.tsx:103:          await supabase.functions.invoke("generate-health-schedule", {
app/add-family-member.tsx:107:          console.error("[generate-health-schedule] Caught:", scheduleErr);
app/log-service/[vehicleId].tsx:228:      const response = await fetch(localUri);
app/log-service/[vehicleId].tsx:230:      const { data, error: uploadErr } = await supabase.storage
app/log-service/[vehicleId].tsx:232:        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
app/(tabs)/index.tsx:355:  function refetch() {
app/(tabs)/index.tsx:457:                refetch();
app/(tabs)/settings.tsx:389:                    const { data, error } = await supabase.functions.invoke("delete-account", {
app/(tabs)/settings.tsx:397:                      await Purchases.logOut();
app/(tabs)/settings.tsx:400:                      console.warn("[delete-account] Purchases.logOut failed:", rcMessage);
app/vehicle-task-history/[vehicleId].tsx:96:      const { data, error } = await supabase.storage
app/property/[id].tsx:18:import * as ImagePicker from "expo-image-picker";
app/property/[id].tsx:145:    refetch();
app/property/[id].tsx:354:        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] })
app/property/[id].tsx:355:        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
app/property/[id].tsx:360:        const response = await fetch(uri);
app/property/[id].tsx:364:        const { error: uploadError } = await supabase.storage
app/property/[id].tsx:366:          .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/property/[id].tsx:368:        const { data: urlData } = supabase.storage.from("property-photos").getPublicUrl(storagePath);
app/property/[id].tsx:387:      await supabase.storage.from("property-photos").remove([storagePath]);
app/add-vehicle.tsx:773:              fetch(`${nhtsaBase}?format=json&vehicleType=Passenger%20Car`, { signal: controller.signal }),
app/add-vehicle.tsx:774:              fetch(`${nhtsaBase}?format=json&vehicleType=Truck`, { signal: controller.signal }),
app/add-vehicle.tsx:775:              fetch(`${nhtsaBase}?format=json&vehicleType=Multipurpose%20Passenger%20Vehicle%20(MPV)`, { signal: controller.signal }),
app/add-vehicle.tsx:788:            const motoResp = await fetch(`${nhtsaBase}?format=json&vehicleType=Motorcycle`, { signal: controller.signal });
app/add-vehicle.tsx:792:            const allResp = await fetch(`${nhtsaBase}?format=json`, { signal: controller.signal });
app/add-vehicle.tsx:798:            const allResp = await fetch(`${nhtsaBase}?format=json`, { signal: controller.signal });
app/add-vehicle.tsx:859:      const res = await fetch(
app/add-vehicle.tsx:1077:            const { error: scheduleError } = await supabase.functions.invoke(
app/add-vehicle.tsx:1078:              "generate-maintenance-schedule",
app/add-vehicle.tsx:1096:              if (httpStatus !== 409) console.warn("[generate-maintenance-schedule] Error:", scheduleError.message);
app/add-vehicle.tsx:1099:            console.warn("[generate-maintenance-schedule] Caught:", scheduleErr);
app/add-vehicle.tsx:1135:          const { error: scheduleError } = await supabase.functions.invoke(
app/add-vehicle.tsx:1136:            "generate-maintenance-schedule",
app/add-vehicle.tsx:1154:            if (httpStatus !== 409) console.warn("[generate-maintenance-schedule] Error:", scheduleError.message);
app/add-vehicle.tsx:1157:          console.warn("[generate-maintenance-schedule] Caught:", scheduleErr);
app/(onboarding)/building-plan.tsx:134:      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
app/vehicle/[id].tsx:19:import * as ImagePicker from "expo-image-picker";
app/vehicle/[id].tsx:229:            return supabase.functions.invoke("estimate-repair-cost", {
app/vehicle/[id].tsx:477:      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
app/vehicle/[id].tsx:518:      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
app/vehicle/[id].tsx:827:        result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
app/vehicle/[id].tsx:829:        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
app/vehicle/[id].tsx:835:      const response = await fetch(uri);
app/vehicle/[id].tsx:839:      const { error: uploadError } = await supabase.storage
app/vehicle/[id].tsx:841:        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/vehicle/[id].tsx:844:      const { data: urlData } = supabase.storage.from("wallet-documents").getPublicUrl(storagePath);
app/vehicle/[id].tsx:862:      await supabase.storage.from("wallet-documents").remove([storagePath]);
app/vehicle/[id].tsx:1013:                const { data: walletFiles } = await supabase.storage
app/vehicle/[id].tsx:1018:                  await supabase.storage
app/vehicle/[id].tsx:2525:      await refetch();
app/vehicle/[id].tsx:2543:        result = await ImagePicker.launchCameraAsync({
app/vehicle/[id].tsx:2549:        result = await ImagePicker.launchImageLibraryAsync({
app/vehicle/[id].tsx:2561:      const response = await fetch(uri);
app/vehicle/[id].tsx:2565:      const { error: uploadError } = await supabase.storage
app/vehicle/[id].tsx:2567:        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/vehicle/[id].tsx:2570:      const { data: urlData } = supabase.storage.from("wallet-documents").getPublicUrl(storagePath);
app/vehicle/[id].tsx:2592:      await refetch();
app/vehicle/[id].tsx:2632:              await supabase.storage.from("wallet-documents").remove([storagePath]);
app/vehicle/[id].tsx:2634:              await refetch();
```

### A3. Files containing BOTH a gate AND a paid-work call

**File:** `app/(tabs)/health.tsx`

```
86:  const [showPaywall, setShowPaywall] = useState(false);
101:        .select("*, family_members(name, relationship, member_type)")
115:        .select("*, family_members(name)")
124:    queryKey: ["family_members", user?.id],
128:        .from("family_members")
157:        .from("family_members")
200:  function refetch() {
391:      const memberName = (overdue as any).family_members?.name;
397:      const memberName = (dueSoon as any).family_members?.name;
415:    setShowPaywall(true);
469:      const memberName = (a as any).family_members?.name ?? "You";
484:      const memberName = (m as any).family_members?.name ?? "You";
603:                {profile?.subscription_tier === "free" && (
729:                        if ((m as any).family_members?.name) metaParts.push((m as any).family_members.name);
771:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
776:          onDismiss={() => setShowPaywall(false)}
917:  const member = (appointment as any).family_members;
```

**File:** `app/(tabs)/settings.tsx`

```
153:    queryKey: ["settings_pred_vehicles", user?.id],
157:        .from("vehicles")
377:            Alert.alert("Are you absolutely sure?", "All vehicles, properties, health records, and history will be deleted.", [
389:                    const { data, error } = await supabase.functions.invoke("delete-account", {
397:                      await Purchases.logOut();
400:                      console.warn("[delete-account] Purchases.logOut failed:", rcMessage);
421:    profile?.subscription_tier === "trial" ||
422:    (!!profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date());
423:  const trialDaysLeft = profile?.trial_expires_at
424:    ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
426:  const isPremium = hasPersonalOrAbove(profile);
427:  const userIsFreeTier = !userIsInTrial && !isPremium;
429:  const expiryDate = profile?.subscription_expires_at ? parseISO(profile.subscription_expires_at) : null;
481:                <Text style={styles.bannerSub}>Upgrade to unlock vehicles, scans & exports</Text>
492:          {isPremium && !userIsInTrial && (
726:            {isPremium && !userIsInTrial && !!profile?.revenuecat_customer_id && (
```

**File:** `app/add-family-member.tsx`

```
45:  const [showPaywall, setShowPaywall] = useState(false);
64:        .from("family_members")
70:        setShowPaywall(true);
74:        setShowPaywall(true);
87:    const { data: newMember, error: err } = await supabase.from("family_members").insert({
100:      queryClient.invalidateQueries({ queryKey: ["family_members"] });
103:          await supabase.functions.invoke("generate-health-schedule", {
202:      {showPaywall && (
203:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
207:            onDismiss={() => setShowPaywall(false)}
```

**File:** `app/add-property.tsx`

```
95:    const { data, error } = await supabase.functions.invoke("places-autocomplete", {
117:    const { data, error } = await supabase.functions.invoke("places-details", {
156:  const [showPaywall, setShowPaywall] = useState(false);
238:        const { data } = await supabase.functions.invoke("property-lookup", {
276:        .from("properties")
281:        setShowPaywall(true);
292:    const { data: newProperty, error: err } = await supabase.from("properties").insert({
312:      // Fire-and-forget: generate AI schedule in background (same pattern as vehicles)
315:          const { error: scheduleError } = await supabase.functions.invoke(
338:    queryClient.invalidateQueries({ queryKey: ["properties"] });
339:    queryClient.invalidateQueries({ queryKey: ["properties", user.id] });
574:      {showPaywall && (
575:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
578:            subtitle="Upgrade to add more properties"
579:            onDismiss={() => setShowPaywall(false)}
```

**File:** `app/add-vehicle.tsx`

```
584:      const { data: vehicles } = await supabase
585:        .from("vehicles")
589:      return (vehicles ?? []) as { id: string; year: number; make: string; model: string; nickname: string | null }[];
618:  const [showPaywall, setShowPaywall] = useState(false);
757:      const nhtsaBase = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodedMake}/modelyear/${yearNum}`;
773:              fetch(`${nhtsaBase}?format=json&vehicleType=Passenger%20Car`, { signal: controller.signal }),
774:              fetch(`${nhtsaBase}?format=json&vehicleType=Truck`, { signal: controller.signal }),
775:              fetch(`${nhtsaBase}?format=json&vehicleType=Multipurpose%20Passenger%20Vehicle%20(MPV)`, { signal: controller.signal }),
788:            const motoResp = await fetch(`${nhtsaBase}?format=json&vehicleType=Motorcycle`, { signal: controller.signal });
792:            const allResp = await fetch(`${nhtsaBase}?format=json`, { signal: controller.signal });
798:            const allResp = await fetch(`${nhtsaBase}?format=json`, { signal: controller.signal });
859:      const res = await fetch(
860:        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${cleanVin}?format=json`
973:        .from("vehicles")
977:        setShowPaywall(true);
1043:          .from("vehicles")
1054:          queryClient.invalidateQueries({ queryKey: ["vehicles"] });
1077:            const { error: scheduleError } = await supabase.functions.invoke(
1104:        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
1106:        queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
1123:        .from("vehicles")
1135:          const { error: scheduleError } = await supabase.functions.invoke(
1162:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
1164:      queryClient.invalidateQueries({ queryKey: ["settings_pred_vehicles"] });
2170:      {showPaywall && (
2171:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
2174:            subtitle="Upgrade to add more vehicles"
2175:            onDismiss={() => setShowPaywall(false)}
2358:        Some makes may not have model data for older vehicles. You can always type a custom make.
```

**File:** `app/log-service/[vehicleId].tsx`

```
25:import ScanPackModal from "@/components/ScanPackModal";
54:  const [showPaywall, setShowPaywall] = useState(false);
55:  const [showScanPackModal, setShowScanPackModal] = useState(false);
91:      .from("vehicles")
158:            .from("vehicles")
165:            .from("properties")
228:      const response = await fetch(localUri);
230:      const { data, error: uploadErr } = await supabase.storage
232:        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
357:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
358:      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
454:                  setShowPaywall(true);
469:                onScanLimitReached={() => setShowPaywall(true)}
470:                onPaidUserAtCap={() => setShowScanPackModal(true)}
692:      {showPaywall && (
693:        <Modal visible animationType="slide" onRequestClose={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}>
697:            onDismiss={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
701:      <ScanPackModal
702:        visible={showScanPackModal}
703:        onClose={() => setShowScanPackModal(false)}
704:        onSuccess={() => setShowScanPackModal(false)}
```

**File:** `app/vehicle/[id].tsx`

```
131:  const [showPaywall, setShowPaywall] = useState(false);
171:      const { data } = await supabase.from("vehicles").select("*").eq("id", id).maybeSingle();
229:            return supabase.functions.invoke("estimate-repair-cost", {
477:      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
518:      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
761:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
827:        result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
829:        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
835:      const response = await fetch(uri);
839:      const { error: uploadError } = await supabase.storage
841:        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
844:      const { data: urlData } = supabase.storage.from("wallet-documents").getPublicUrl(storagePath);
847:      await supabase.from("vehicles").update({ photo_url: publicUrl }).eq("id", id!);
849:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
862:      await supabase.storage.from("wallet-documents").remove([storagePath]);
863:      await supabase.from("vehicles").update({ photo_url: null }).eq("id", id!);
865:      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
980:            queryClient.setQueryData(["vehicles", userId], (old: any) => {
999:            // Navigate safely to vehicles list
1003:              router.replace("/(tabs)/vehicles");
1013:                const { data: walletFiles } = await supabase.storage
1018:                  await supabase.storage
1024:                await supabase.from("vehicles").delete().eq("id", vehicleId);
1026:                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
1033:                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
1044:      setShowPaywall(true);
1696:      {showPaywall && (
1697:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
1701:            onDismiss={() => setShowPaywall(false)}
2410:  vehicles: { make: string | null; model: string | null; year: number | null; nickname: string | null } | null;
2421:  const v = row.vehicles;
2450:        .select("*, vehicles!inner(make, model, year, nickname)")
2525:      await refetch();
2543:        result = await ImagePicker.launchCameraAsync({
2549:        result = await ImagePicker.launchImageLibraryAsync({
2561:      const response = await fetch(uri);
2565:      const { error: uploadError } = await supabase.storage
2567:        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
2570:      const { data: urlData } = supabase.storage.from("wallet-documents").getPublicUrl(storagePath);
2592:      await refetch();
2632:              await supabase.storage.from("wallet-documents").remove([storagePath]);
2634:              await refetch();
```

**File:** `components/Paywall.tsx`

```
46:      "3 vehicles + 2 properties",
63:      "6 vehicles + 5 properties",
79:      "Unlimited vehicles & properties",
132:  const latestProfileTierRef = useRef<string | null>(profile?.subscription_tier ?? null);
134:    latestProfileTierRef.current = profile?.subscription_tier ?? null;
135:  }, [profile?.subscription_tier]);
189:      const offerings = await Purchases.getOfferings();
217:    // outages. Do not tell the user the purchase failed while purchasePackage
235:        message: "This is taking longer than expected. You can leave this screen — if Apple completes the charge, come back and tap Restore Purchases.",
276:      const { customerInfo } = await Purchases.purchasePackage(pkg);
311:              message: "The purchase went through. Tap Restore Purchases. If it still won't unlock, email support@lifemaintained.com.",
359:      const customerInfo = await Purchases.restorePurchases();
413:      const { data, error } = await supabase.functions.invoke("apply-promo-code", {
654:                {profile?.subscription_tier === "trial" && profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date()
```

**File:** `components/ReceiptScanButton.tsx`

```
20:  onScanLimitReached?: () => void;
21:  /** Paid user hits cap — caller typically opens ScanPackModal. */
25:export default function ReceiptScanButton({ assetType, assetId, onScanComplete, onScanLimitReached, onPaidUserAtCap }: Props) {
54:        ? await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false })
55:        : await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ["images"] });
81:          const handler = onPaidUserAtCap ?? onScanLimitReached;
```

**File:** `components/ScanPackModal.tsx`

```
32:interface ScanPackModalProps {
38:export default function ScanPackModal({ visible, onClose, onSuccess }: ScanPackModalProps) {
56:      const purchaseResult = await Purchases.purchaseProduct(pack.id);
```

### A4. Cross-component paid-action call-stack map

```
components/ReceiptScanButton.tsx-21-  /** Paid user hits cap — caller typically opens ScanPackModal. */
components/ReceiptScanButton.tsx-22-  onPaidUserAtCap?: () => void;
components/ReceiptScanButton.tsx-23-}
components/ReceiptScanButton.tsx-24-
components/ReceiptScanButton.tsx:25:export default function ReceiptScanButton({ assetType, assetId, onScanComplete, onScanLimitReached, onPaidUserAtCap }: Props) {
components/ReceiptScanButton.tsx-26-  const [scanning, setScanning] = useState(false);
components/ReceiptScanButton.tsx-27-  const [toastVisible, setToastVisible] = useState(false);
components/ReceiptScanButton.tsx-28-  const [toastMessage, setToastMessage] = useState("");
components/ReceiptScanButton.tsx-29-  const [toastSubtitle, setToastSubtitle] = useState<string | null>(null);
components/ReceiptScanButton.tsx-30-  const [toastIsError, setToastIsError] = useState(true);
components/ReceiptScanButton.tsx-31-
components/ReceiptScanButton.tsx-32-  function showToast(message: string, subtitle?: string, isError = true) {
components/ReceiptScanButton.tsx-33-    setToastMessage(message);
components/ReceiptScanButton.tsx-34-    setToastSubtitle(subtitle ?? null);
components/ReceiptScanButton.tsx-35-    setToastIsError(isError);
components/ReceiptScanButton.tsx-36-    setToastVisible(true);
components/ReceiptScanButton.tsx-37-    setTimeout(() => setToastVisible(false), 2600);
components/ReceiptScanButton.tsx-38-  }
components/ReceiptScanButton.tsx-39-
components/ReceiptScanButton.tsx:40:  const handleScan = async (useCamera: boolean) => {
components/ReceiptScanButton.tsx-41-    const source: ReceiptScanSource = useCamera ? "camera" : "photo_library";
components/ReceiptScanButton.tsx-42-
components/ReceiptScanButton.tsx-43-    try {
components/ReceiptScanButton.tsx-44-      if (useCamera) {
components/ReceiptScanButton.tsx-45-        const { status } = await ImagePicker.requestCameraPermissionsAsync();
components/ReceiptScanButton.tsx-46-        if (status !== "granted") {
components/ReceiptScanButton.tsx-47-          showToast("Camera access is off", "Allow camera access in Settings to scan receipts.");
components/ReceiptScanButton.tsx-48-          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
components/ReceiptScanButton.tsx-49-          return;
components/ReceiptScanButton.tsx-50-        }
components/ReceiptScanButton.tsx-51-      }
components/ReceiptScanButton.tsx-52-
--
components/ReceiptScanButton.tsx-102-  };
components/ReceiptScanButton.tsx-103-
components/ReceiptScanButton.tsx-104-  const showOptions = () => {
components/ReceiptScanButton.tsx-105-    Alert.alert("Scan Receipt", "How would you like to add a receipt?", [
components/ReceiptScanButton.tsx:106:      { text: "Take Photo", onPress: () => handleScan(true) },
components/ReceiptScanButton.tsx:107:      { text: "Choose from Library", onPress: () => handleScan(false) },
components/ReceiptScanButton.tsx-108-      { text: "Cancel", style: "cancel" },
components/ReceiptScanButton.tsx-109-    ]);
components/ReceiptScanButton.tsx-110-  };
components/ReceiptScanButton.tsx-111-
components/ReceiptScanButton.tsx-112-  if (scanning) {
components/ReceiptScanButton.tsx-113-    return (
components/ReceiptScanButton.tsx-114-      <View style={styles.scanningContainer}>
components/ReceiptScanButton.tsx-115-        <ActivityIndicator size="small" color={Colors.accent} />
components/ReceiptScanButton.tsx-116-        <Text style={styles.scanningText}>Scanning receipt...</Text>
components/ReceiptScanButton.tsx-117-      </View>
components/ReceiptScanButton.tsx-118-    );
components/ReceiptScanButton.tsx-119-  }
--
components/LogSheet.tsx-67-  isRecording: boolean;
components/LogSheet.tsx-68-  phase: RecordPhase;
components/LogSheet.tsx-69-};
components/LogSheet.tsx-70-
components/LogSheet.tsx:71:function VoiceOrb({ amplitudeRef, isRecording, phase }: OrbProps) {
components/LogSheet.tsx-72-  // Breathing layers
components/LogSheet.tsx-73-  const outerScale   = useSharedValue(1.0);
components/LogSheet.tsx-74-  const outerOpacity = useSharedValue(0.06);
components/LogSheet.tsx-75-  const midScale     = useSharedValue(1.0);
components/LogSheet.tsx-76-  const coreScale    = useSharedValue(1.0);
components/LogSheet.tsx-77-
components/LogSheet.tsx-78-  // Sonar pulse rings (4 rings × scale + opacity)
components/LogSheet.tsx-79-  const r1s = useSharedValue(0.3); const r1o = useSharedValue(0.35);
components/LogSheet.tsx-80-  const r2s = useSharedValue(0.3); const r2o = useSharedValue(0.35);
components/LogSheet.tsx-81-  const r3s = useSharedValue(0.3); const r3o = useSharedValue(0.35);
components/LogSheet.tsx-82-  const r4s = useSharedValue(0.3); const r4o = useSharedValue(0.35);
components/LogSheet.tsx-83-
--
components/LogSheet.tsx-435-    </View>
components/LogSheet.tsx-436-  );
components/LogSheet.tsx-437-}
components/LogSheet.tsx-438-
components/LogSheet.tsx:439:// ─── LogSheet ────────────────────────────────────────────────────────────────
components/LogSheet.tsx-440-
components/LogSheet.tsx:441:export function LogSheet({
components/LogSheet.tsx-442-  visible, onClose, userId,
components/LogSheet.tsx-443-}: {
components/LogSheet.tsx-444-  visible: boolean;
components/LogSheet.tsx-445-  onClose: () => void;
components/LogSheet.tsx-446-  userId: string;
components/LogSheet.tsx-447-}) {
components/LogSheet.tsx-448-  const insets = useSafeAreaInsets();
components/LogSheet.tsx-449-  const [phase, setPhase] = useState<RecordPhase>("idle");
components/LogSheet.tsx-450-  const [text, setText] = useState("");
components/LogSheet.tsx-451-  const [items, setItems] = useState<ExtractedItem[]>([]);
components/LogSheet.tsx-452-  const [doneCount, setDoneCount] = useState(0);
components/LogSheet.tsx-453-  const [errorMsg, setErrorMsg] = useState("");
--
components/LogSheet.tsx-488-    recordingRef.current = null;
components/LogSheet.tsx-489-    try {
components/LogSheet.tsx-490-      await rec.stopAndUnloadAsync();
components/LogSheet.tsx-491-    } catch (err) {
components/LogSheet.tsx:492:      console.warn("[LogSheet] recorder stopAndUnload failed:", err);
components/LogSheet.tsx-493-    }
components/LogSheet.tsx-494-    try {
components/LogSheet.tsx-495-      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
components/LogSheet.tsx-496-    } catch (err) {
components/LogSheet.tsx:497:      console.warn("[LogSheet] audio mode reset failed:", err);
components/LogSheet.tsx-498-    }
components/LogSheet.tsx-499-  }
components/LogSheet.tsx-500-
components/LogSheet.tsx-501-  async function handleStartRecording() {
components/LogSheet.tsx-502-    try {
components/LogSheet.tsx-503-      const { granted } = await Audio.requestPermissionsAsync();
components/LogSheet.tsx-504-      if (!granted) {
components/LogSheet.tsx-505-        setPhase("type");
components/LogSheet.tsx-506-        return;
components/LogSheet.tsx-507-      }
components/LogSheet.tsx-508-      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
components/LogSheet.tsx-509-
--
components/LogSheet.tsx-523-      recordingRef.current = rec;
components/LogSheet.tsx-524-      setPhase("recording");
components/LogSheet.tsx-525-      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
components/LogSheet.tsx-526-    } catch (err) {
components/LogSheet.tsx:527:      console.error("[LogSheet] Start recording error:", err);
components/LogSheet.tsx-528-      setPhase("type");
components/LogSheet.tsx-529-    }
components/LogSheet.tsx-530-  }
components/LogSheet.tsx-531-
components/LogSheet.tsx-532-  async function handleStopRecording() {
components/LogSheet.tsx-533-    const rec = recordingRef.current;
components/LogSheet.tsx-534-    if (!rec) { setPhase("type"); return; }
components/LogSheet.tsx-535-
components/LogSheet.tsx-536-    try {
components/LogSheet.tsx-537-      await rec.stopAndUnloadAsync();
components/LogSheet.tsx-538-      const uri = rec.getURI();
components/LogSheet.tsx-539-      recordingRef.current = null;
--
components/LogSheet.tsx-543-      setPhase("transcribing");
components/LogSheet.tsx-544-      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
components/LogSheet.tsx-545-      await handleTranscribe(uri);
components/LogSheet.tsx-546-    } catch (err) {
components/LogSheet.tsx:547:      console.error("[LogSheet] Stop recording error:", err);
components/LogSheet.tsx-548-      recordingRef.current = null;
components/LogSheet.tsx-549-      setPhase("type");
components/LogSheet.tsx-550-    }
components/LogSheet.tsx-551-  }
components/LogSheet.tsx-552-
components/LogSheet.tsx-553-  async function handleTranscribe(uri: string | null) {
components/LogSheet.tsx-554-    if (!uri) {
components/LogSheet.tsx-555-      setPhase("type");
components/LogSheet.tsx-556-      return;
components/LogSheet.tsx-557-    }
components/LogSheet.tsx-558-    try {
components/LogSheet.tsx-559-      const canTranscribe = await checkVoiceTranscriptionLimit();
--
components/LogSheet.tsx-679-            </View>
components/LogSheet.tsx-680-
components/LogSheet.tsx-681-            {/* Orb — centered in upper portion */}
components/LogSheet.tsx-682-            <View style={styles.recordingCenter}>
components/LogSheet.tsx:683:              <VoiceOrb
components/LogSheet.tsx-684-                amplitudeRef={amplitudeRef}
components/LogSheet.tsx-685-                isRecording={phase === "recording"}
components/LogSheet.tsx-686-                phase={phase}
components/LogSheet.tsx-687-              />
components/LogSheet.tsx-688-            </View>
components/LogSheet.tsx-689-
components/LogSheet.tsx-690-            {/* Bottom group: button → status text → type-instead */}
components/LogSheet.tsx-691-            <View style={styles.recordingBottom}>
components/LogSheet.tsx-692-              {phase === "transcribing" ? (
components/LogSheet.tsx-693-                <View style={styles.transcribingRow}>
components/LogSheet.tsx-694-                  <ActivityIndicator size="small" color={Colors.accent} />
components/LogSheet.tsx-695-                  <Text style={styles.transcribingText}>Processing audio...</Text>
--
app/(tabs)/_layout.tsx-9-import { Colors } from "@/constants/colors";
app/(tabs)/_layout.tsx-10-import { useSafeAreaInsets } from "react-native-safe-area-context";
app/(tabs)/_layout.tsx-11-import * as Haptics from "expo-haptics";
app/(tabs)/_layout.tsx-12-import { useAuth } from "@/context/AuthContext";
app/(tabs)/_layout.tsx:13:import { LogSheet } from "@/components/LogSheet";
app/(tabs)/_layout.tsx-14-
app/(tabs)/_layout.tsx-15-function NativeTabLayout() {
app/(tabs)/_layout.tsx-16-  return (
app/(tabs)/_layout.tsx-17-    <NativeTabs>
app/(tabs)/_layout.tsx-18-      <NativeTabs.Trigger name="index">
app/(tabs)/_layout.tsx-19-        <Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} />
app/(tabs)/_layout.tsx-20-        <Label>Dashboard</Label>
app/(tabs)/_layout.tsx-21-      </NativeTabs.Trigger>
app/(tabs)/_layout.tsx-22-      <NativeTabs.Trigger name="vehicles">
app/(tabs)/_layout.tsx-23-        <Icon sf={{ default: "car", selected: "car.fill" }} />
app/(tabs)/_layout.tsx-24-        <Label>Vehicles</Label>
app/(tabs)/_layout.tsx-25-      </NativeTabs.Trigger>
--
app/(tabs)/_layout.tsx-135-  );
app/(tabs)/_layout.tsx-136-}
app/(tabs)/_layout.tsx-137-
app/(tabs)/_layout.tsx-138-export default function TabLayout() {
app/(tabs)/_layout.tsx:139:  const [logSheetVisible, setLogSheetVisible] = useState(false);
app/(tabs)/_layout.tsx-140-  const { user } = useAuth();
app/(tabs)/_layout.tsx-141-  const insets = useSafeAreaInsets();
app/(tabs)/_layout.tsx-142-  const isNative = isLiquidGlassAvailable();
app/(tabs)/_layout.tsx-143-
app/(tabs)/_layout.tsx-144-  return (
app/(tabs)/_layout.tsx-145-    <View style={{ flex: 1 }}>
app/(tabs)/_layout.tsx-146-      {isNative ? <NativeTabLayout /> : <ClassicTabLayout />}
app/(tabs)/_layout.tsx-147-
app/(tabs)/_layout.tsx-148-      <Pressable
app/(tabs)/_layout.tsx-149-        style={[
app/(tabs)/_layout.tsx-150-          styles.fab,
app/(tabs)/_layout.tsx-151-          {
--
app/(tabs)/_layout.tsx-154-          },
app/(tabs)/_layout.tsx-155-        ]}
app/(tabs)/_layout.tsx-156-        onPress={() => {
app/(tabs)/_layout.tsx-157-          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
app/(tabs)/_layout.tsx:158:          setLogSheetVisible(true);
app/(tabs)/_layout.tsx-159-        }}
app/(tabs)/_layout.tsx-160-        accessibilityLabel="Record voice maintenance log"
app/(tabs)/_layout.tsx-161-        accessibilityRole="button"
app/(tabs)/_layout.tsx-162-      >
app/(tabs)/_layout.tsx-163-        <Ionicons name="mic-outline" size={22} color="#fff" />
app/(tabs)/_layout.tsx-164-      </Pressable>
app/(tabs)/_layout.tsx-165-
app/(tabs)/_layout.tsx:166:      <LogSheet
app/(tabs)/_layout.tsx-167-        visible={logSheetVisible}
app/(tabs)/_layout.tsx:168:        onClose={() => setLogSheetVisible(false)}
app/(tabs)/_layout.tsx-169-        userId={user?.id ?? ""}
app/(tabs)/_layout.tsx-170-      />
app/(tabs)/_layout.tsx-171-    </View>
app/(tabs)/_layout.tsx-172-  );
app/(tabs)/_layout.tsx-173-}
app/(tabs)/_layout.tsx-174-
app/(tabs)/_layout.tsx-175-const styles = StyleSheet.create({
app/(tabs)/_layout.tsx-176-  fab: {
app/(tabs)/_layout.tsx-177-    position: "absolute",
app/(tabs)/_layout.tsx-178-    width: 48,
app/(tabs)/_layout.tsx-179-    height: 48,
app/(tabs)/_layout.tsx-180-    borderRadius: 24,
--
app/log-service/[vehicleId].tsx-19-import { supabase } from "@/lib/supabase";
app/log-service/[vehicleId].tsx-20-import { useAuth } from "@/context/AuthContext";
app/log-service/[vehicleId].tsx-21-import * as Haptics from "expo-haptics";
app/log-service/[vehicleId].tsx-22-import { useQueryClient } from "@tanstack/react-query";
app/log-service/[vehicleId].tsx:23:import ReceiptScanButton from "@/components/ReceiptScanButton";
app/log-service/[vehicleId].tsx-24-import Paywall from "@/components/Paywall";
app/log-service/[vehicleId].tsx-25-import ScanPackModal from "@/components/ScanPackModal";
app/log-service/[vehicleId].tsx-26-import { isFreeTier } from "@/lib/subscription";
app/log-service/[vehicleId].tsx-27-import { ReceiptScanResult } from "@/lib/receiptScanner";
app/log-service/[vehicleId].tsx-28-import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
app/log-service/[vehicleId].tsx-29-import DatePicker from "@/components/DatePicker";
app/log-service/[vehicleId].tsx-30-import { parseISO, format } from "date-fns";
app/log-service/[vehicleId].tsx-31-import { SaveToast } from "@/components/SaveToast";
app/log-service/[vehicleId].tsx-32-import { matchAndUpdateVehicleTask, CATEGORY_GROUPS, type MatchResult } from "@/lib/maintenanceMatcher";
app/log-service/[vehicleId].tsx-33-import { resolveTrackingMode, isHoursTracked, isMileageTracked } from "@/lib/usageHelpers";
app/log-service/[vehicleId].tsx-34-import { updateVehicleUsage } from "@/lib/vehicleUsageHelper";
app/log-service/[vehicleId].tsx-35-import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
--
app/log-service/[vehicleId].tsx-181-    }, 700);
app/log-service/[vehicleId].tsx-182-    return () => { if (insightTimerRef.current) clearTimeout(insightTimerRef.current); };
app/log-service/[vehicleId].tsx-183-  }, [task, user?.id, vehicleId]);
app/log-service/[vehicleId].tsx-184-
app/log-service/[vehicleId].tsx:185:  function handleScanComplete(result: ReceiptScanResult) {
app/log-service/[vehicleId].tsx-186-    if (__DEV__) {
app/log-service/[vehicleId].tsx-187-      console.log("Scan result:", JSON.stringify(result));
app/log-service/[vehicleId].tsx-188-      console.log("Scan result fields - task:", result.task, "serviceType:", result.serviceType, "cost:", result.cost, "provider:", result.provider, "mileage:", result.mileage, "date:", result.date);
app/log-service/[vehicleId].tsx-189-    }
app/log-service/[vehicleId].tsx-190-    if (result.date) setDate(result.date);
app/log-service/[vehicleId].tsx-191-    if (result.mileage != null) setMileage(String(result.mileage));
app/log-service/[vehicleId].tsx-192-    if (result.provider) setProvider(result.provider);
app/log-service/[vehicleId].tsx-193-    if (result.localUri) setReceiptLocalUri(result.localUri);
app/log-service/[vehicleId].tsx-194-
app/log-service/[vehicleId].tsx-195-    if (result.items && result.items.length > 1) {
app/log-service/[vehicleId].tsx-196-      setScannedItems(result.items);
app/log-service/[vehicleId].tsx-197-      setCost(result.cost != null ? String(result.cost) : "");
--
app/log-service/[vehicleId].tsx-461-                  <Text style={styles.scanLockedText}>Upgrade</Text>
app/log-service/[vehicleId].tsx-462-                </View>
app/log-service/[vehicleId].tsx-463-              </Pressable>
app/log-service/[vehicleId].tsx-464-            ) : (
app/log-service/[vehicleId].tsx:465:              <ReceiptScanButton
app/log-service/[vehicleId].tsx-466-                assetType="vehicle"
app/log-service/[vehicleId].tsx-467-                assetId={vehicleId}
app/log-service/[vehicleId].tsx:468:                onScanComplete={handleScanComplete}
app/log-service/[vehicleId].tsx-469-                onScanLimitReached={() => setShowPaywall(true)}
app/log-service/[vehicleId].tsx-470-                onPaidUserAtCap={() => setShowScanPackModal(true)}
app/log-service/[vehicleId].tsx-471-              />
app/log-service/[vehicleId].tsx-472-            )}
app/log-service/[vehicleId].tsx-473-          </View>
app/log-service/[vehicleId].tsx-474-
app/log-service/[vehicleId].tsx-475-          {scannedItems.length > 0 && (
app/log-service/[vehicleId].tsx-476-            <View style={styles.fieldGroup}>
app/log-service/[vehicleId].tsx-477-              <Text style={styles.groupLabel}>Services Found ({scannedItems.length})</Text>
app/log-service/[vehicleId].tsx-478-
app/log-service/[vehicleId].tsx-479-              {scannedItems.map((item, index) => (
app/log-service/[vehicleId].tsx-480-                <View key={index} style={styles.itemRow}>
--
app/(tabs)/index.tsx-33-import { useBudgetAlert } from "@/context/BudgetAlertContext";
app/(tabs)/index.tsx-34-import TrialBanner from "@/components/TrialBanner";
app/(tabs)/index.tsx-35-import { resolveTrackingMode, calcVehicleTaskStatus, isHoursTrackedMode, isMileageTrackedMode, isHoursTracked, isTimeOnly } from "@/lib/usageHelpers";
app/(tabs)/index.tsx-36-import * as Linking from "expo-linking";
app/(tabs)/index.tsx:37:import { LogSheet } from "@/components/LogSheet";
app/(tabs)/index.tsx-38-import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
app/(tabs)/index.tsx-39-import UpdateBanner from "@/components/UpdateBanner";
app/(tabs)/index.tsx-40-
app/(tabs)/index.tsx-41-if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
app/(tabs)/index.tsx-42-  UIManager.setLayoutAnimationEnabledExperimental(true);
app/(tabs)/index.tsx-43-}
app/(tabs)/index.tsx-44-
app/(tabs)/index.tsx-45-const SCREENING_NOTIF_KEY = "screening_notif_optins";
app/(tabs)/index.tsx-46-
app/(tabs)/index.tsx-47-const CAT = {
app/(tabs)/index.tsx-48-  vehicles: { color: Colors.blue, muted: Colors.blueMuted, icon: "car" as const, label: "Vehicles", desc: "Cars, trucks, motorcycles & more", addRoute: "/add-vehicle" as any, tab: "/(tabs)/vehicles" as any },
app/(tabs)/index.tsx-49-  properties: { color: Colors.good, muted: Colors.goodMuted, icon: "home" as const, label: "Properties", desc: "Home, HVAC, roof & appliances", addRoute: "/add-property" as any, tab: "/(tabs)/home-tab" as any },
--
app/(tabs)/index.tsx-159-  const insets = useSafeAreaInsets();
app/(tabs)/index.tsx-160-  const { user } = useAuth();
app/(tabs)/index.tsx-161-  const [screeningOptIns, setScreeningOptIns] = useState<Record<string, boolean>>({});
app/(tabs)/index.tsx-162-  const [budgetDismissed, setBudgetDismissed] = useState(false);
app/(tabs)/index.tsx:163:  const [logSheetVisible, setLogSheetVisible] = useState(false);
app/(tabs)/index.tsx-164-  const handledDeepLinkRef = useRef<string | null>(null);
app/(tabs)/index.tsx-165-  const webTopPad = Platform.OS === "web" ? 67 : 0;
app/(tabs)/index.tsx-166-  const { monthlyCost, budgetThreshold } = useBudgetAlert();
app/(tabs)/index.tsx-167-
app/(tabs)/index.tsx-168-  // Deep link: lifemaintained://voice-log → auto-open the voice log sheet
app/(tabs)/index.tsx-169-  useEffect(() => {
app/(tabs)/index.tsx-170-    if (!user) return;
app/(tabs)/index.tsx-171-
app/(tabs)/index.tsx-172-    const openIfMatch = (url: string | null) => {
app/(tabs)/index.tsx-173-      if (!url || url === handledDeepLinkRef.current) return;
app/(tabs)/index.tsx-174-      try {
app/(tabs)/index.tsx-175-        const parsed = Linking.parse(url);
app/(tabs)/index.tsx-176-        if (parsed.scheme === "lifemaintained" && parsed.path === "voice-log") {
app/(tabs)/index.tsx-177-          handledDeepLinkRef.current = url;
app/(tabs)/index.tsx:178:          setLogSheetVisible(true);
app/(tabs)/index.tsx-179-        }
app/(tabs)/index.tsx-180-      } catch {}
app/(tabs)/index.tsx-181-    };
app/(tabs)/index.tsx-182-
app/(tabs)/index.tsx-183-    Linking.getInitialURL().then(openIfMatch);
app/(tabs)/index.tsx-184-    const sub = Linking.addEventListener("url", (e) => openIfMatch(e.url));
app/(tabs)/index.tsx-185-    return () => sub.remove();
app/(tabs)/index.tsx-186-  }, [user]);
app/(tabs)/index.tsx-187-
app/(tabs)/index.tsx-188-  useEffect(() => {
app/(tabs)/index.tsx-189-    AsyncStorage.getItem(SCREENING_NOTIF_KEY).then(raw => {
app/(tabs)/index.tsx-190-      if (raw) {
--
app/(tabs)/index.tsx-528-        )}
app/(tabs)/index.tsx-529-      </View>
app/(tabs)/index.tsx-530-    </ScrollView>
app/(tabs)/index.tsx-531-
app/(tabs)/index.tsx:532:    <LogSheet
app/(tabs)/index.tsx-533-      visible={logSheetVisible}
app/(tabs)/index.tsx:534:      onClose={() => setLogSheetVisible(false)}
app/(tabs)/index.tsx-535-      userId={user?.id ?? ""}
app/(tabs)/index.tsx-536-    />
app/(tabs)/index.tsx-537-    </View>
app/(tabs)/index.tsx-538-  );
app/(tabs)/index.tsx-539-}
app/(tabs)/index.tsx-540-
app/(tabs)/index.tsx-541-function formatMileageAge(updatedAt: string | null): string {
app/(tabs)/index.tsx-542-  if (!updatedAt) return "Never updated";
app/(tabs)/index.tsx-543-  const days = differenceInDays(new Date(), parseISO(updatedAt));
app/(tabs)/index.tsx-544-  if (days === 0) return "Updated today";
app/(tabs)/index.tsx-545-  if (days === 1) return "Updated 1d ago";
app/(tabs)/index.tsx-546-  return `Updated ${days}d ago`;
--
app/(tabs)/index.tsx-827-    </View>
app/(tabs)/index.tsx-828-  );
app/(tabs)/index.tsx-829-}
app/(tabs)/index.tsx-830-
app/(tabs)/index.tsx:831:// ConfirmCard and LogSheet moved to components/LogSheet.tsx
app/(tabs)/index.tsx-832-
app/(tabs)/index.tsx-833-function DashboardSkeleton() {
app/(tabs)/index.tsx-834-  const anim = usePulse();
app/(tabs)/index.tsx-835-  return (
app/(tabs)/index.tsx-836-    <View style={{ gap: 20 }}>
app/(tabs)/index.tsx-837-      <Row gap={10} align="flex-start">
app/(tabs)/index.tsx-838-        {[0, 1, 2].map(i => (
app/(tabs)/index.tsx-839-          <View key={i} style={[styles.catCard, { gap: 8 }]}>
app/(tabs)/index.tsx-840-            <S anim={anim} w={44} h={44} r={13} />
app/(tabs)/index.tsx-841-            <S anim={anim} w={36} h={22} r={6} />
app/(tabs)/index.tsx-842-            <S anim={anim} w="65%" h={11} r={5} />
app/(tabs)/index.tsx-843-          </View>
```

## Pattern B — Paid-surface UX audit

### B1. ScanPackModal full source

```tsx
     1	import React, { useState } from "react";
     2	import {
     3	  View,
     4	  Text,
     5	  StyleSheet,
     6	  Pressable,
     7	  ActivityIndicator,
     8	  Modal,
     9	  Platform,
    10	} from "react-native";
    11	import { Ionicons } from "@expo/vector-icons";
    12	import { Colors } from "@/constants/colors";
    13	import { supabase } from "@/lib/supabase";
    14	import { useAuth } from "@/context/AuthContext";
    15	import * as Haptics from "expo-haptics";
    16	import { SaveToast } from "@/components/SaveToast";
    17	import { useSafeAreaInsets } from "react-native-safe-area-context";
    18	
    19	interface ScanPack {
    20	  id: "scan_pack_10" | "scan_pack_25";
    21	  title: string;
    22	  scans: number;
    23	  price: string;
    24	  popular?: boolean;
    25	}
    26	
    27	const PACKS: ScanPack[] = [
    28	  { id: "scan_pack_10", title: "10 scans", scans: 10, price: "$2.99" },
    29	  { id: "scan_pack_25", title: "25 scans", scans: 25, price: "$4.99", popular: true },
    30	];
    31	
    32	interface ScanPackModalProps {
    33	  visible: boolean;
    34	  onClose: () => void;
    35	  onSuccess: () => void;
    36	}
    37	
    38	export default function ScanPackModal({ visible, onClose, onSuccess }: ScanPackModalProps) {
    39	  const insets = useSafeAreaInsets();
    40	  const { user, refreshProfile } = useAuth();
    41	  const [purchasingId, setPurchasingId] = useState<string | null>(null);
    42	  const [toastVisible, setToastVisible] = useState(false);
    43	  const [purchaseError, setPurchaseError] = useState<string | null>(null);
    44	
    45	  async function handlePurchase(pack: ScanPack) {
    46	    setPurchaseError(null);
    47	    if (!user || Platform.OS === "web") {
    48	      setPurchaseError("Open LifeMaintained on iPhone to buy a scan pack.");
    49	      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    50	      return;
    51	    }
    52	    setPurchasingId(pack.id);
    53	    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    54	    try {
    55	      const Purchases = (await import("react-native-purchases")).default;
    56	      const purchaseResult = await Purchases.purchaseProduct(pack.id);
    57	
    58	      // Pull StoreKit transaction id for idempotency.
    59	      // Do NOT fall back to productIdentifier — two purchases of the same pack
    60	      // would collide on the same key and the second purchase would be silently
    61	      // ignored, taking the user's money without granting credits.
    62	      const txId =
    63	        (purchaseResult as any)?.transaction?.transactionIdentifier ??
    64	        null;
    65	      if (!txId || typeof txId !== "string") {
    66	        throw new Error("Missing transaction id from purchase result");
    67	      }
    68	
    69	      const source = pack.id === "scan_pack_10" ? "pack_10" : "pack_25";
    70	      const { data: rpcData, error: rpcErr } = await supabase.rpc("grant_scan_pack_credits", {
    71	        p_user_id: user.id,
    72	        p_source: source,
    73	        p_transaction_id: txId,
    74	        p_scans_granted: pack.scans,
    75	      });
    76	
    77	      if (rpcErr) {
    78	        throw new Error(rpcErr.message ?? "Failed to grant credits");
    79	      }
    80	      const rpc = (rpcData ?? {}) as { ok?: boolean; idempotent?: boolean; error?: string; credits_granted?: number };
    81	      if (rpc.error) {
    82	        throw new Error(`Credit grant failed: ${rpc.error}`);
    83	      }
    84	
    85	      await refreshProfile();
    86	
    87	      setPurchaseError(null);
    88	      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    89	      setToastVisible(true);
    90	      setTimeout(() => {
    91	        setToastVisible(false);
    92	        onSuccess();
    93	      }, 1200);
    94	    } catch (err: any) {
    95	      if (!err?.userCancelled) {
    96	        if (__DEV__) console.error("Scan pack purchase failed:", err);
    97	        setPurchaseError("Couldn't complete the purchase. No charge was made — try again.");
    98	        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    99	      }
   100	    } finally {
   101	      setPurchasingId(null);
   102	    }
   103	  }
   104	
   105	  const botPad = Platform.OS === "web" ? 34 : insets.bottom;
   106	
   107	  return (
   108	    <Modal
   109	      visible={visible}
   110	      animationType="slide"
   111	      transparent
   112	      onRequestClose={onClose}
   113	    >
   114	      <Pressable style={styles.overlay} onPress={onClose} />
   115	      <View style={[styles.sheet, { paddingBottom: botPad + 16 }]}>
   116	        <View style={styles.handle} />
   117	
   118	        <View style={styles.titleRow}>
   119	          <View style={styles.titleIconWrap}>
   120	            <Ionicons name="scan-outline" size={22} color={Colors.accent} />
   121	          </View>
   122	          <View style={{ flex: 1 }}>
   123	            <Text style={styles.title}>You're out of scans this month</Text>
   124	            <Text style={styles.subtitle}>Pick up where you left off — credits never expire</Text>
   125	          </View>
   126	        </View>
   127	
   128	        {purchaseError ? (
   129	          <View style={styles.errorCard}>
   130	            <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
   131	            <Text style={styles.errorText}>{purchaseError}</Text>
   132	          </View>
   133	        ) : null}
   134	
   135	        {PACKS.map(pack => {
   136	          const isPurchasing = purchasingId === pack.id;
   137	          return (
   138	            <Pressable
   139	              key={pack.id}
   140	              style={({ pressed }) => [
   141	                styles.packCard,
   142	                pack.popular && styles.packCardPopular,
   143	                { opacity: pressed || (purchasingId !== null && !isPurchasing) ? 0.6 : 1 },
   144	              ]}
   145	              onPress={() => handlePurchase(pack)}
   146	              disabled={purchasingId !== null}
   147	              testID={`scan-pack-${pack.scans}`}
   148	            >
   149	              {pack.popular && (
   150	                <View style={styles.bestValueBadge}>
   151	                  <Text style={styles.bestValueText}>Save 40%</Text>
   152	                </View>
   153	              )}
   154	              <View style={styles.packLeft}>
   155	                <Ionicons name="receipt-outline" size={20} color={pack.popular ? Colors.accent : Colors.textSecondary} />
   156	                <Text style={[styles.packTitle, pack.popular && { color: Colors.text }]}>{pack.title}</Text>
   157	              </View>
   158	              <View style={styles.packRight}>
   159	                {isPurchasing ? (
   160	                  <ActivityIndicator size="small" color={Colors.accent} />
   161	                ) : (
   162	                  <Text style={[styles.packPrice, pack.popular && { color: Colors.accent }]}>{pack.price}</Text>
   163	                )}
   164	              </View>
   165	            </Pressable>
   166	          );
   167	        })}
   168	
   169	        <Pressable
   170	          style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
   171	          onPress={onClose}
   172	        >
   173	          <Text style={styles.cancelText}>Cancel</Text>
   174	        </Pressable>
   175	
   176	        <SaveToast visible={toastVisible} message="Scans added to your account" />
   177	      </View>
   178	    </Modal>
   179	  );
   180	}
   181	
   182	const styles = StyleSheet.create({
   183	  overlay: {
   184	    flex: 1,
   185	    backgroundColor: "rgba(0,0,0,0.5)",
   186	  },
   187	  sheet: {
   188	    backgroundColor: Colors.card,
   189	    borderTopLeftRadius: 20,
   190	    borderTopRightRadius: 20,
   191	    paddingHorizontal: 16,
   192	    paddingTop: 12,
   193	    gap: 12,
   194	  },
   195	  handle: {
   196	    width: 36,
   197	    height: 4,
   198	    borderRadius: 2,
   199	    backgroundColor: Colors.border,
   200	    alignSelf: "center",
   201	    marginBottom: 4,
   202	  },
   203	  titleRow: {
   204	    flexDirection: "row",
   205	    alignItems: "center",
   206	    gap: 12,
   207	    paddingVertical: 4,
   208	  },
   209	  titleIconWrap: {
   210	    width: 44,
   211	    height: 44,
   212	    borderRadius: 12,
   213	    backgroundColor: Colors.accentLight,
   214	    alignItems: "center",
   215	    justifyContent: "center",
   216	    borderWidth: 1,
   217	    borderColor: Colors.accentMuted,
   218	  },
   219	  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.text },
   220	  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
   221	  packCard: {
   222	    flexDirection: "row",
   223	    alignItems: "center",
   224	    justifyContent: "space-between",
   225	    backgroundColor: Colors.surface,
   226	    borderRadius: 14,
   227	    padding: 16,
   228	    borderWidth: 1,
   229	    borderColor: Colors.border,
   230	    position: "relative",
   231	  },
   232	  packCardPopular: {
   233	    borderColor: Colors.accentMuted,
   234	    backgroundColor: Colors.accentLight,
   235	  },
   236	  bestValueBadge: {
   237	    position: "absolute",
   238	    top: -8,
   239	    right: 14,
   240	    backgroundColor: Colors.accent,
   241	    borderRadius: 8,
   242	    paddingHorizontal: 8,
   243	    paddingVertical: 2,
   244	  },
   245	  bestValueText: { fontSize: 10, fontFamily: "Inter_700Bold", color: Colors.background },
   246	  packLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
   247	  packTitle: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary, flex: 1 },
   248	  packRight: { minWidth: 52, alignItems: "flex-end" },
   249	  packPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.text },
   250	  cancelBtn: { alignItems: "center", paddingVertical: 8 },
   251	  cancelText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
   252	  errorCard: {
   253	    flexDirection: "row",
   254	    gap: 8,
   255	    alignItems: "center",
   256	    backgroundColor: Colors.card,
   257	    borderWidth: 1,
   258	    borderColor: Colors.overdue,
   259	    borderRadius: 12,
   260	    paddingHorizontal: 12,
   261	    paddingVertical: 10,
   262	  },
   263	  errorText: {
   264	    flex: 1,
   265	    fontSize: 13,
   266	    fontFamily: "Inter_500Medium",
   267	    color: Colors.overdue,
   268	    lineHeight: 18,
   269	  },
   270	});
```

### B2. Paywall full source

```tsx
     1	import React, { useState, useEffect, useRef } from "react";
     2	import {
     3	  View,
     4	  Text,
     5	  ScrollView,
     6	  StyleSheet,
     7	  Pressable,
     8	  ActivityIndicator,
     9	  TextInput,
    10	  Platform,
    11	  Animated,
    12	  KeyboardAvoidingView,
    13	} from "react-native";
    14	import { useSafeAreaInsets } from "react-native-safe-area-context";
    15	import { Ionicons } from "@expo/vector-icons";
    16	import { Colors } from "@/constants/colors";
    17	import { supabase } from "@/lib/supabase";
    18	import { useAuth } from "@/context/AuthContext";
    19	import * as Haptics from "expo-haptics";
    20	import { SaveToast } from "@/components/SaveToast";
    21	import { rcReady, extractTierHintFromCustomerInfo, syncSubscriptionFromRc } from "@/lib/revenuecat";
    22	
    23	type Billing = "monthly" | "annual";
    24	type TierKey = "personal" | "pro" | "business";
    25	
    26	const TIER_CONFIG: Record<TierKey, {
    27	  label: string;
    28	  icon: keyof typeof Ionicons.glyphMap;
    29	  color: string;
    30	  rcOffering: string;
    31	  annualPrice: string;
    32	  annualMonthly: string;
    33	  monthlyPrice: string;
    34	  popular?: boolean;
    35	  features: string[];
    36	}> = {
    37	  personal: {
    38	    label: "Personal",
    39	    icon: "person",
    40	    color: Colors.accent,
    41	    rcOffering: "default",
    42	    annualPrice: "$49.99/year",
    43	    annualMonthly: "$4.17/mo",
    44	    monthlyPrice: "$7.99/month",
    45	    features: [
    46	      "3 vehicles + 2 properties",
    47	      "1 person + 1 pet",
    48	      "15 AI receipt scans/month",
    49	      "Voice logging",
    50	      "Push notifications",
    51	    ],
    52	  },
    53	  pro: {
    54	    label: "Pro",
    55	    icon: "briefcase",
    56	    color: Colors.vehicle,
    57	    rcOffering: "pro",
    58	    annualPrice: "$99.99/year",
    59	    annualMonthly: "$8.33/mo",
    60	    monthlyPrice: "$11.99/month",
    61	    popular: true,
    62	    features: [
    63	      "6 vehicles + 5 properties",
    64	      "5 people + 3 pets",
    65	      "30 AI receipt scans/month",
    66	      "Voice logging",
    67	      "Export to PDF/CSV",
    68	    ],
    69	  },
    70	  business: {
    71	    label: "Business",
    72	    icon: "business",
    73	    color: Colors.health,
    74	    rcOffering: "business",
    75	    annualPrice: "$249.99/year",
    76	    annualMonthly: "$20.83/mo",
    77	    monthlyPrice: "$34.99/month",
    78	    features: [
    79	      "Unlimited vehicles & properties",
    80	      "Unlimited people & pets",
    81	      "100 AI receipt scans/month",
    82	      "Voice logging",
    83	      "Export to PDF/CSV",
    84	      "Priority support",
    85	    ],
    86	  },
    87	};
    88	
    89	type PaywallInlineError = {
    90	  title: string;
    91	  message: string;
    92	  actionLabel?: string;
    93	  onAction?: () => void;
    94	  feedback?: "error" | "warning";
    95	};
    96	
    97	interface PaywallProps {
    98	  canDismiss: boolean;
    99	  showSkip?: boolean;
   100	  onDismiss?: () => void;
   101	  onSkip?: () => void;
   102	  subtitle?: string;
   103	}
   104	
   105	export default function Paywall({
   106	  canDismiss,
   107	  showSkip = false,
   108	  onDismiss,
   109	  onSkip,
   110	  subtitle = "Choose the plan that fits your life",
   111	}: PaywallProps) {
   112	  const insets = useSafeAreaInsets();
   113	  const { user, profile, refreshProfile } = useAuth();
   114	  const [billing, setBilling] = useState<Billing>("annual");
   115	  const [selectedTier, setSelectedTier] = useState<TierKey>("personal");
   116	  const [isPurchasing, setIsPurchasing] = useState(false);
   117	  const [isRestoring, setIsRestoring] = useState(false);
   118	  const [showPromo, setShowPromo] = useState(false);
   119	  const [promoCode, setPromoCode] = useState("");
   120	  const [promoStatus, setPromoStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
   121	  const [promoMessage, setPromoMessage] = useState<string | null>(null);
   122	  const [loadedOfferings, setLoadedOfferings] = useState<any | null>(null);
   123	  const [offeringsError, setOfferingsError] = useState(false);
   124	  const [loadingOfferings, setLoadingOfferings] = useState(Platform.OS !== "web");
   125	  const [toastVisible, setToastVisible] = useState(false);
   126	  const [toastMessage, setToastMessage] = useState("You're in. Trial starts now.");
   127	  const [toastSubtitle, setToastSubtitle] = useState<string | null>(null);
   128	  const [toastIsError, setToastIsError] = useState(false);
   129	  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   130	  const [inlineError, setInlineError] = useState<PaywallInlineError | null>(null);
   131	  const purchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   132	  const latestProfileTierRef = useRef<string | null>(profile?.subscription_tier ?? null);
   133	  useEffect(() => {
   134	    latestProfileTierRef.current = profile?.subscription_tier ?? null;
   135	  }, [profile?.subscription_tier]);
   136	
   137	  useEffect(() => {
   138	    return () => {
   139	      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
   140	    };
   141	  }, []);
   142	
   143	  const waitForWebhookProfileTier = async (expectedTier: string): Promise<boolean> => {
   144	    for (let i = 0; i < 8; i++) {
   145	      await refreshProfile();
   146	      if (latestProfileTierRef.current === expectedTier) return true;
   147	      if (i < 7) await new Promise(r => setTimeout(r, 1000));
   148	    }
   149	    return false;
   150	  };
   151	
   152	  useEffect(() => {
   153	    if (Platform.OS === "web") return;
   154	    loadOfferings();
   155	  }, []);
   156	
   157	  function showToast(message: string, subtitle?: string, isError = false, duration = 2400) {
   158	    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
   159	    setToastMessage(message);
   160	    setToastSubtitle(subtitle ?? null);
   161	    setToastIsError(isError);
   162	    setToastVisible(true);
   163	    toastTimerRef.current = setTimeout(() => {
   164	      setToastVisible(false);
   165	      toastTimerRef.current = null;
   166	    }, duration);
   167	  }
   168	
   169	  function showInlineError(next: PaywallInlineError) {
   170	    setInlineError(next);
   171	    const feedbackType =
   172	      next.feedback === "warning"
   173	        ? Haptics.NotificationFeedbackType.Warning
   174	        : Haptics.NotificationFeedbackType.Error;
   175	    Haptics.notificationAsync(feedbackType).catch(() => {});
   176	  }
   177	
   178	  function clearPaywallError() {
   179	    setInlineError(null);
   180	  }
   181	
   182	  async function loadOfferings(retried = false) {
   183	    setLoadingOfferings(true);
   184	    setOfferingsError(false);
   185	    clearPaywallError();
   186	    try {
   187	      await rcReady;
   188	      const Purchases = (await import("react-native-purchases")).default;
   189	      const offerings = await Purchases.getOfferings();
   190	      setLoadedOfferings(offerings);
   191	    } catch (e) {
   192	      console.error("[Paywall] getOfferings failed:", e);
   193	      if (!retried) {
   194	        setTimeout(() => loadOfferings(true), 3000);
   195	      } else {
   196	        setOfferingsError(true);
   197	      }
   198	    } finally {
   199	      setLoadingOfferings(false);
   200	    }
   201	  }
   202	
   203	  async function handlePurchase() {
   204	    if (!user || Platform.OS === "web") {
   205	      showInlineError({
   206	        title: "Sign in required",
   207	        message: "Please sign in to start a subscription.",
   208	        actionLabel: "Try again",
   209	        onAction: handlePurchase,
   210	      });
   211	      return;
   212	    }
   213	    setIsPurchasing(true);
   214	    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
   215	
   216	    // Apple sandbox routinely takes >30s and can exceed 120s during
   217	    // outages. Do not tell the user the purchase failed while purchasePackage
   218	    // is still in flight.
   219	    //
   220	    // 30s soft hint: toast only. Spinner stays. CTA stays disabled.
   221	    // 150s long-wait nudge: advisory Alert only. Does NOT set isPurchasing
   222	    // false — that would re-enable the CTA and allow a duplicate purchase
   223	    // attempt while StoreKit is still working. The original purchase promise
   224	    // remains authoritative and runs the normal finally{} cleanup when it
   225	    // eventually resolves or rejects.
   226	    purchaseTimeoutRef.current = setTimeout(() => {
   227	      setToastMessage("Still waiting on Apple…");
   228	      setToastVisible(true);
   229	      setTimeout(() => setToastVisible(false), 2400);
   230	    }, 30000);
   231	
   232	    const purchaseEscapeTimeout = setTimeout(() => {
   233	      showInlineError({
   234	        title: "Still waiting on Apple",
   235	        message: "This is taking longer than expected. You can leave this screen — if Apple completes the charge, come back and tap Restore Purchases.",
   236	        feedback: "warning",
   237	      });
   238	    }, 150000);
   239	
   240	    try {
   241	      const Purchases = (await import("react-native-purchases")).default;
   242	      const cfg = TIER_CONFIG[selectedTier];
   243	      const offering = cfg.rcOffering === "default"
   244	        ? loadedOfferings?.current
   245	        : loadedOfferings?.all?.[cfg.rcOffering] ?? null;
   246	
   247	      if (!offering) {
   248	        if (purchaseTimeoutRef.current) { clearTimeout(purchaseTimeoutRef.current); purchaseTimeoutRef.current = null; }
   249	        clearTimeout(purchaseEscapeTimeout);
   250	        setIsPurchasing(false);
   251	        showInlineError({
   252	          title: "Couldn't load pricing",
   253	          message: "Check your connection and try again.",
   254	          actionLabel: "Try again",
   255	          onAction: () => loadOfferings(false),
   256	        });
   257	        return;
   258	      }
   259	
   260	      const pkg = billing === "annual"
   261	        ? (offering.annual ?? offering.availablePackages[0])
   262	        : (offering.monthly ?? offering.availablePackages[0]);
   263	
   264	      if (!pkg) {
   265	        if (purchaseTimeoutRef.current) { clearTimeout(purchaseTimeoutRef.current); purchaseTimeoutRef.current = null; }
   266	        clearTimeout(purchaseEscapeTimeout);
   267	        setIsPurchasing(false);
   268	        showInlineError({
   269	          title: "Plan unavailable",
   270	          message: "This plan isn't available right now. Try another plan or check back shortly.",
   271	          feedback: "warning",
   272	        });
   273	        return;
   274	      }
   275	
   276	      const { customerInfo } = await Purchases.purchasePackage(pkg);
   277	      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
   278	      clearTimeout(purchaseEscapeTimeout);
   279	
   280	      const active = customerInfo?.entitlements?.active ?? {};
   281	      const tier = active["business_access"] ? "business"
   282	        : active["pro_access"] ? "pro"
   283	        : active["personal_access"] ? "personal" : null;
   284	
   285	      if (tier) {
   286	        const synced = await waitForWebhookProfileTier(tier);
   287	
   288	        if (synced) {
   289	          setToastMessage("You're in. Trial starts now.");
   290	          setToastVisible(true);
   291	          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
   292	          setTimeout(() => {
   293	            setToastVisible(false);
   294	            onDismiss?.();
   295	          }, 1600);
   296	        } else {
   297	          const syncResult = await syncSubscriptionFromRc();
   298	          await refreshProfile();
   299	
   300	          if (syncResult.ok && latestProfileTierRef.current === tier) {
   301	            setToastMessage("You're in. Trial starts now.");
   302	            setToastVisible(true);
   303	            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
   304	            setTimeout(() => {
   305	              setToastVisible(false);
   306	              onDismiss?.();
   307	            }, 1600);
   308	          } else {
   309	            showInlineError({
   310	              title: "Just a moment",
   311	              message: "The purchase went through. Tap Restore Purchases. If it still won't unlock, email support@lifemaintained.com.",
   312	              actionLabel: "Restore Purchases",
   313	              onAction: handleRestore,
   314	              feedback: "warning",
   315	            });
   316	          }
   317	        }
   318	      } else {
   319	        console.warn("[Paywall] Purchase completed but no entitlement found:", JSON.stringify(active));
   320	        showInlineError({
   321	          title: "Activation needs a retry",
   322	          message: "Your purchase was processed, but we couldn't activate your plan. Tap Restore Purchases, or contact support@lifemaintained.com.",
   323	          actionLabel: "Restore Purchases",
   324	          onAction: handleRestore,
   325	          feedback: "warning",
   326	        });
   327	      }
   328	    } catch (err: any) {
   329	      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
   330	      clearTimeout(purchaseEscapeTimeout);
   331	      if (!err?.userCancelled) {
   332	        showInlineError({
   333	          title: "Purchase didn't go through",
   334	          message: err?.message ?? "No charge was made. Try again or pick a different plan.",
   335	          actionLabel: "Try again",
   336	          onAction: handlePurchase,
   337	        });
   338	      }
   339	    } finally {
   340	      setIsPurchasing(false);
   341	    }
   342	  }
   343	
   344	  async function handleRestore() {
   345	    if (Platform.OS === "web") return;
   346	    if (!user) {
   347	      showInlineError({
   348	        title: "Sign in required",
   349	        message: "Please sign in to restore your purchases.",
   350	        actionLabel: "Try again",
   351	        onAction: handleRestore,
   352	      });
   353	      return;
   354	    }
   355	    setIsRestoring(true);
   356	    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
   357	    try {
   358	      const Purchases = (await import("react-native-purchases")).default;
   359	      const customerInfo = await Purchases.restorePurchases();
   360	      const tierHint = extractTierHintFromCustomerInfo(customerInfo);
   361	
   362	      if (!tierHint) {
   363	        showInlineError({
   364	          title: "No purchases found",
   365	          message: "We couldn't find purchases on this Apple ID. Contact support@lifemaintained.com if you think this is wrong.",
   366	        });
   367	        return;
   368	      }
   369	
   370	      const syncResult = await syncSubscriptionFromRc();
   371	      if (!syncResult.ok) {
   372	        showInlineError({
   373	          title: "Restore couldn't finish",
   374	          message: "We saw your purchase, but couldn't update your account. Please try again or contact support@lifemaintained.com.",
   375	          actionLabel: "Try again",
   376	          onAction: handleRestore,
   377	        });
   378	        return;
   379	      }
   380	
   381	      await refreshProfile();
   382	
   383	      if (syncResult.tier === "free") {
   384	        showInlineError({
   385	          title: "No active subscription",
   386	          message: "We couldn't find an active subscription on this Apple ID. Contact support@lifemaintained.com if you think this is wrong.",
   387	        });
   388	        return;
   389	      }
   390	
   391	      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
   392	      setToastMessage("Purchases restored!");
   393	      setToastVisible(true);
   394	      setTimeout(() => { setToastVisible(false); onDismiss?.(); }, 1600);
   395	    } catch (e) {
   396	      console.error("[Paywall] Restore failed:", e);
   397	      showInlineError({
   398	        title: "Couldn't restore purchases",
   399	        message: "Make sure you're signed into the same Apple ID you used to subscribe, then try again.",
   400	        actionLabel: "Try again",
   401	        onAction: handleRestore,
   402	      });
   403	    } finally {
   404	      setIsRestoring(false);
   405	    }
   406	  }
   407	
   408	  async function handleApplyPromo() {
   409	    const code = promoCode.toUpperCase().trim();
   410	    if (!code || !user) return;
   411	    setPromoStatus("checking");
   412	    try {
   413	      const { data, error } = await supabase.functions.invoke("apply-promo-code", {
   414	        body: { code },
   415	      });
   416	
   417	      if (error) {
   418	        const msg = (error as any)?.message ?? "Could not validate code. Please try again.";
   419	        setPromoStatus("error");
   420	        setPromoMessage(msg);
   421	        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
   422	        return;
   423	      }
   424	
   425	      if (data?.error) {
   426	        setPromoStatus("error");
   427	        setPromoMessage(data.error);
   428	        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
   429	        return;
   430	      }
   431	
   432	      await refreshProfile();
   433	
   434	      setPromoStatus("success");
   435	      setPromoMessage(data?.message ? `Code applied! ${data.message}.` : "Code applied!");
   436	      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
   437	      if (canDismiss && onDismiss) {
   438	        setTimeout(() => {
   439	          onDismiss();
   440	        }, 1600);
   441	      }
   442	    } catch {
   443	      setPromoStatus("error");
   444	      setPromoMessage("Could not validate code. Please try again.");
   445	    }
   446	  }
   447	
   448	  const topPad = Platform.OS === "web" ? 67 : insets.top;
   449	  const botPad = Platform.OS === "web" ? 34 : insets.bottom;
   450	  const tiers: TierKey[] = ["personal", "pro", "business"];
   451	
   452	  if (Platform.OS === "web") {
   453	    return (
   454	      <View style={[styles.webFallback, { paddingTop: topPad + 16, paddingBottom: botPad + 16 }]}>
   455	        {canDismiss && (
   456	          <Pressable style={styles.closeBtn} onPress={onDismiss}>
   457	            <Ionicons name="close" size={22} color={Colors.text} />
   458	          </Pressable>
   459	        )}
   460	        <View style={styles.webFallbackInner}>
   461	          <Ionicons name="phone-portrait-outline" size={48} color={Colors.accent} />
   462	          <Text style={styles.webFallbackTitle}>Subscribe on Mobile</Text>
   463	          <Text style={styles.webFallbackSub}>
   464	            Download LifeMaintained on iOS or Android to start your free trial.
   465	          </Text>
   466	        </View>
   467	      </View>
   468	    );
   469	  }
   470	
   471	  return (
   472	    <KeyboardAvoidingView
   473	      style={{ flex: 1, backgroundColor: Colors.background }}
   474	      behavior={Platform.OS === "ios" ? "padding" : undefined}
   475	      keyboardVerticalOffset={Platform.OS === "ios" ? topPad + 8 : 0}
   476	    >
   477	    <View style={[styles.container, { paddingTop: topPad }]}>
   478	      <View style={styles.header}>
   479	        {canDismiss ? (
   480	          <Pressable
   481	            style={styles.closeBtn}
   482	            onPress={onDismiss}
   483	            hitSlop={8}
   484	            testID="paywall-close"
   485	          >
   486	            <Ionicons name="close" size={22} color={Colors.text} />
   487	          </Pressable>
   488	        ) : (
   489	          <View style={styles.closeBtn} />
   490	        )}
   491	        <View style={styles.headerCenter}>
   492	          <Text style={styles.headerTitle}>LifeMaintained Premium</Text>
   493	          <Text style={styles.headerSubtitle}>{subtitle}</Text>
   494	        </View>
   495	        <View style={styles.closeBtn} />
   496	      </View>
   497	
   498	      {loadingOfferings ? (
   499	        <View style={styles.loadingContainer}>
   500	          <ActivityIndicator color={Colors.accent} size="large" />
   501	        </View>
   502	      ) : offeringsError ? (
   503	        <View style={styles.offeringsErrorContainer}>
   504	          <View style={styles.offeringsErrorIcon}>
   505	            <Ionicons name="cloud-offline-outline" size={30} color={Colors.accent} />
   506	          </View>
   507	          <Text style={styles.offeringsErrorTitle}>Couldn't load plans</Text>
   508	          <Text style={styles.offeringsErrorText}>
   509	            Check your connection and try again.
   510	          </Text>
   511	          <Pressable
   512	            style={({ pressed }) => [styles.offeringsRetryBtn, { opacity: pressed ? 0.82 : 1 }]}
   513	            onPress={() => loadOfferings(false)}
   514	            accessibilityRole="button"
   515	            accessibilityLabel="Try loading plans again"
   516	          >
   517	            <Text style={styles.offeringsRetryText}>Try again</Text>
   518	          </Pressable>
   519	        </View>
   520	      ) : (
   521	        <ScrollView
   522	          showsVerticalScrollIndicator={false}
   523	          contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 32 }]}
   524	          keyboardShouldPersistTaps="handled"
   525	        >
   526	          {/* Billing toggle — segmented control */}
   527	          <View style={styles.billingToggle}>
   528	            {(["monthly", "annual"] as Billing[]).map(b => (
   529	              <Pressable
   530	                key={b}
   531	                style={[styles.billingOption, billing === b && styles.billingActive]}
   532	                onPress={() => { setBilling(b); Haptics.selectionAsync(); }}
   533	              >
   534	                <View style={styles.billingOptionContent}>
   535	                  <Text style={[styles.billingLabel, billing === b && styles.billingLabelActive]}>
   536	                    {b === "monthly" ? "Monthly" : "Annual"}
   537	                  </Text>
   538	                  {b === "annual" && (
   539	                    <Text style={[styles.saveText, billing === "annual" && styles.saveTextActive]}>
   540	                      {"  "}Save 40%
   541	                    </Text>
   542	                  )}
   543	                </View>
   544	              </Pressable>
   545	            ))}
   546	          </View>
   547	
   548	          {tiers.map(tier => {
   549	            const cfg = TIER_CONFIG[tier];
   550	            const selected = selectedTier === tier;
   551	            return (
   552	              <View key={tier} style={styles.tierWrapper}>
   553	                {cfg.popular && (
   554	                  <Text style={[styles.popularLabel, { color: cfg.color }]}>Most Popular</Text>
   555	                )}
   556	                <Pressable
   557	                  style={[
   558	                    styles.tierCard,
   559	                    selected && { borderColor: cfg.color, backgroundColor: cfg.color + "0C" },
   560	                  ]}
   561	                  onPress={() => { setSelectedTier(tier); Haptics.selectionAsync(); }}
   562	                  testID={`tier-${tier}`}
   563	                >
   564	                  <View style={styles.tierTop}>
   565	                    <View style={{ flex: 1 }}>
   566	                      <Text style={[styles.tierName, { color: selected ? cfg.color : Colors.text }]}>
   567	                        {cfg.label}
   568	                      </Text>
   569	                      <Text style={styles.tierPrice}>
   570	                        {billing === "annual" ? cfg.annualPrice : cfg.monthlyPrice}
   571	                      </Text>
   572	                      {billing === "annual" && (
   573	                        <Text style={styles.tierPriceSub}>{cfg.annualMonthly} · billed annually</Text>
   574	                      )}
   575	                    </View>
   576	                    <View style={[
   577	                      styles.radioOuter,
   578	                      selected && { borderColor: cfg.color },
   579	                    ]}>
   580	                      {selected && <View style={[styles.radioInner, { backgroundColor: cfg.color }]} />}
   581	                    </View>
   582	                  </View>
   583	                  <View style={styles.tierFeatures}>
   584	                    {cfg.features.map((f, i) => (
   585	                      <View key={i} style={styles.featureRow}>
   586	                        <Text style={styles.featureBullet}>–</Text>
   587	                        <Text style={styles.featureText}>{f}</Text>
   588	                      </View>
   589	                    ))}
   590	                  </View>
   591	                </Pressable>
   592	              </View>
   593	            );
   594	          })}
   595	
   596	          <View style={styles.scanLimitsBox}>
   597	            <Text style={styles.scanLimitsTitle}>AI scan limits</Text>
   598	            <Text style={styles.scanLimitsText}>Free: 0 AI scans/month</Text>
   599	            <Text style={styles.scanLimitsText}>Personal: 15 AI scans/month</Text>
   600	            <Text style={styles.scanLimitsText}>Pro: 30 AI scans/month</Text>
   601	            <Text style={styles.scanLimitsText}>Business: 100 AI scans/month</Text>
   602	          </View>
   603	
   604	          <Text style={styles.trialCalloutText}>
   605	            14 days free · Full access · Manage in Settings
   606	          </Text>
   607	
   608	          {inlineError && (
   609	            <View style={[
   610	              styles.inlineErrorCard,
   611	              inlineError.feedback === "warning" && styles.inlineWarningCard,
   612	            ]}>
   613	              <View style={styles.inlineErrorIcon}>
   614	                <Ionicons
   615	                  name={inlineError.feedback === "warning" ? "time-outline" : "alert-circle"}
   616	                  size={18}
   617	                  color={inlineError.feedback === "warning" ? Colors.accent : Colors.overdue}
   618	                />
   619	              </View>
   620	              <View style={styles.inlineErrorTextBlock}>
   621	                <Text style={styles.inlineErrorTitle}>{inlineError.title}</Text>
   622	                <Text style={styles.inlineErrorMessage}>{inlineError.message}</Text>
   623	              </View>
   624	              {inlineError.actionLabel && inlineError.onAction && (
   625	                <Pressable
   626	                  style={({ pressed }) => [styles.inlineErrorAction, { opacity: pressed ? 0.75 : 1 }]}
   627	                  onPress={() => {
   628	                    const action = inlineError.onAction;
   629	                    clearPaywallError();
   630	                    action?.();
   631	                  }}
   632	                >
   633	                  <Text style={styles.inlineErrorActionText}>{inlineError.actionLabel}</Text>
   634	                </Pressable>
   635	              )}
   636	            </View>
   637	          )}
   638	
   639	          <Pressable
   640	            style={({ pressed }) => [
   641	              styles.ctaBtn,
   642	              { opacity: pressed || isPurchasing ? 0.85 : 1 },
   643	            ]}
   644	            onPress={handlePurchase}
   645	            disabled={isPurchasing || isRestoring || loadingOfferings}
   646	            testID="paywall-cta"
   647	            accessibilityLabel="Subscribe to plan"
   648	            accessibilityRole="button"
   649	          >
   650	            {isPurchasing ? (
   651	              <ActivityIndicator color={Colors.background} />
   652	            ) : (
   653	              <Text style={styles.ctaBtnText}>
   654	                {profile?.subscription_tier === "trial" && profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date()
   655	                  ? "Choose Plan"
   656	                  : "Start Free Trial"}
   657	              </Text>
   658	            )}
   659	          </Pressable>
   660	
   661	          <Text style={styles.legalText}>
   662	            Cancel anytime · Billed through App Store after trial
   663	          </Text>
   664	
   665	          {showSkip && (
   666	            <Pressable
   667	              style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
   668	              onPress={onSkip}
   669	              testID="paywall-skip"
   670	            >
   671	              <Text style={styles.skipText}>Maybe later</Text>
   672	            </Pressable>
   673	          )}
   674	
   675	          <Pressable
   676	            style={({ pressed }) => [styles.restoreBtn, { opacity: pressed || isRestoring ? 0.6 : 1 }]}
   677	            onPress={handleRestore}
   678	            disabled={isRestoring || isPurchasing}
   679	          >
   680	            {isRestoring
   681	              ? <ActivityIndicator size="small" color={Colors.textTertiary} />
   682	              : <Text style={styles.restoreText}>Restore Purchases</Text>
   683	            }
   684	          </Pressable>
   685	
   686	          <Pressable
   687	            style={({ pressed }) => [styles.promoToggle, { opacity: pressed ? 0.7 : 1 }]}
   688	            onPress={() => { setShowPromo(p => !p); setPromoStatus("idle"); setPromoMessage(null); }}
   689	          >
   690	            <Text style={styles.promoToggleText}>
   691	              {showPromo ? "Hide promo code" : "Have a promo code?"}
   692	            </Text>
   693	          </Pressable>
   694	
   695	          {showPromo && (
   696	            <View style={styles.promoSection}>
   697	              <View style={styles.promoRow}>
   698	                <TextInput
   699	                  style={styles.promoInput}
   700	                  value={promoCode}
   701	                  onChangeText={t => { setPromoCode(t); setPromoStatus("idle"); setPromoMessage(null); }}
   702	                  placeholder="Enter code"
   703	                  placeholderTextColor={Colors.textTertiary}
   704	                  autoCapitalize="characters"
   705	                  returnKeyType="done"
   706	                  onSubmitEditing={handleApplyPromo}
   707	                />
   708	                <Pressable
   709	                  style={({ pressed }) => [styles.promoApplyBtn, { opacity: pressed || promoStatus === "checking" ? 0.7 : 1 }]}
   710	                  onPress={handleApplyPromo}
   711	                  disabled={promoStatus === "checking"}
   712	                >
   713	                  {promoStatus === "checking"
   714	                    ? <ActivityIndicator size="small" color={Colors.textInverse} />
   715	                    : <Text style={styles.promoApplyText}>Apply</Text>
   716	                  }
   717	                </Pressable>
   718	              </View>
   719	              {promoMessage && (
   720	                <View style={styles.promoFeedback}>
   721	                  <Ionicons
   722	                    name={promoStatus === "success" ? "checkmark-circle" : "alert-circle"}
   723	                    size={14}
   724	                    color={promoStatus === "success" ? Colors.good : Colors.overdue}
   725	                  />
   726	                  <Text style={[
   727	                    styles.promoFeedbackText,
   728	                    { color: promoStatus === "success" ? Colors.good : Colors.overdue },
   729	                  ]}>
   730	                    {promoMessage}
   731	                  </Text>
   732	                </View>
   733	              )}
   734	            </View>
   735	          )}
   736	        </ScrollView>
   737	      )}
   738	      <SaveToast
   739	        visible={toastVisible}
   740	        message={toastMessage}
   741	        subtitle={toastSubtitle ?? undefined}
   742	        isError={toastIsError}
   743	      />
   744	    </View>
   745	    </KeyboardAvoidingView>
   746	  );
   747	}
   748	
   749	const styles = StyleSheet.create({
   750	  container: { flex: 1, backgroundColor: Colors.background },
   751	  header: {
   752	    flexDirection: "row",
   753	    alignItems: "center",
   754	    paddingHorizontal: 20,
   755	    paddingBottom: 14,
   756	    borderBottomWidth: 1,
   757	    borderBottomColor: Colors.border,
   758	  },
   759	  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
   760	  headerCenter: { flex: 1, alignItems: "center", gap: 4 },
   761	  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
   762	  headerSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
   763	  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
   764	  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
   765	
   766	  // Billing toggle — segmented control
   767	  billingToggle: {
   768	    flexDirection: "row",
   769	    borderRadius: 14,
   770	    borderWidth: 1,
   771	    borderColor: Colors.border,
   772	    overflow: "hidden",
   773	    backgroundColor: Colors.card,
   774	  },
   775	  billingOption: {
   776	    flex: 1,
   777	    alignItems: "center",
   778	    justifyContent: "center",
   779	    paddingVertical: 12,
   780	  },
   781	  billingActive: { backgroundColor: Colors.accent },
   782	  billingOptionContent: { flexDirection: "row", alignItems: "center" },
   783	  billingLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
   784	  billingLabelActive: { color: Colors.textInverse, fontFamily: "Inter_600SemiBold" },
   785	  saveText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.accent },
   786	  saveTextActive: { color: Colors.textInverse },
   787	
   788	  // Tier cards
   789	  tierWrapper: { gap: 4 },
   790	  popularLabel: {
   791	    fontSize: 11,
   792	    fontFamily: "Inter_600SemiBold",
   793	    paddingLeft: 2,
   794	  },
   795	  tierCard: {
   796	    backgroundColor: Colors.card,
   797	    borderRadius: 14,
   798	    padding: 16,
   799	    borderWidth: 1,
   800	    borderColor: Colors.border,
   801	    gap: 12,
   802	  },
   803	  tierTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
   804	  tierName: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
   805	  tierPrice: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 26 },
   806	  tierPriceSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
   807	  radioOuter: {
   808	    width: 20,
   809	    height: 20,
   810	    borderRadius: 10,
   811	    borderWidth: 2,
   812	    borderColor: Colors.border,
   813	    alignItems: "center",
   814	    justifyContent: "center",
   815	    marginTop: 4,
   816	  },
   817	  radioInner: { width: 10, height: 10, borderRadius: 5 },
   818	  tierFeatures: { gap: 6 },
   819	  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
   820	  featureBullet: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, width: 10 },
   821	  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 },
   822	
   823	  scanLimitsBox: {
   824	    backgroundColor: Colors.surface,
   825	    borderRadius: 12,
   826	    paddingHorizontal: 12,
   827	    paddingVertical: 10,
   828	    gap: 2,
   829	  },
   830	  scanLimitsTitle: {
   831	    fontSize: 12,
   832	    fontFamily: "Inter_600SemiBold",
   833	    color: Colors.text,
   834	    marginBottom: 2,
   835	  },
   836	  scanLimitsText: {
   837	    fontSize: 12,
   838	    fontFamily: "Inter_400Regular",
   839	    color: Colors.textSecondary,
   840	  },
   841	
   842	  trialCalloutText: {
   843	    fontSize: 13,
   844	    fontFamily: "Inter_400Regular",
   845	    color: Colors.textSecondary,
   846	    textAlign: "center",
   847	  },
   848	  ctaBtn: {
   849	    backgroundColor: Colors.accent,
   850	    borderRadius: 14,
   851	    height: 52,
   852	    alignItems: "center",
   853	    justifyContent: "center",
   854	  },
   855	  ctaBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.textInverse },
   856	  legalText: {
   857	    fontSize: 12,
   858	    fontFamily: "Inter_400Regular",
   859	    color: Colors.textTertiary,
   860	    textAlign: "center",
   861	    marginTop: -8,
   862	  },
   863	  skipBtn: { alignItems: "center", paddingVertical: 4 },
   864	  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
   865	  restoreBtn: { alignItems: "center", paddingVertical: 8 },
   866	  restoreText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
   867	  promoToggle: { alignItems: "center", paddingVertical: 4 },
   868	  promoToggleText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
   869	  promoSection: { gap: 8, marginTop: -4 },
   870	  promoRow: { flexDirection: "row", gap: 8 },
   871	  promoInput: {
   872	    flex: 1,
   873	    backgroundColor: Colors.surface,
   874	    borderRadius: 10,
   875	    borderWidth: 1,
   876	    borderColor: Colors.border,
   877	    paddingHorizontal: 14,
   878	    paddingVertical: 12,
   879	    fontSize: 16,
   880	    fontFamily: "Inter_400Regular",
   881	    color: Colors.text,
   882	  },
   883	  promoApplyBtn: {
   884	    backgroundColor: Colors.accent,
   885	    borderRadius: 10,
   886	    paddingHorizontal: 16,
   887	    justifyContent: "center",
   888	    minWidth: 64,
   889	    alignItems: "center",
   890	  },
   891	  promoApplyText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.background },
   892	  promoFeedback: { flexDirection: "row", alignItems: "center", gap: 6 },
   893	  promoFeedbackText: { fontSize: 14, fontFamily: "Inter_400Regular" },
   894	  webFallback: { flex: 1, backgroundColor: Colors.background, position: "relative" },
   895	  webFallbackInner: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
   896	  webFallbackTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
   897	  webFallbackSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
   898	
   899	  inlineErrorCard: {
   900	    flexDirection: "row",
   901	    alignItems: "flex-start",
   902	    gap: 10,
   903	    backgroundColor: Colors.surface,
   904	    borderRadius: 14,
   905	    borderWidth: 1,
   906	    borderColor: Colors.overdue,
   907	    padding: 14,
   908	  },
   909	  inlineWarningCard: { borderColor: Colors.accent },
   910	  inlineErrorIcon: {
   911	    width: 28,
   912	    height: 28,
   913	    borderRadius: 14,
   914	    alignItems: "center",
   915	    justifyContent: "center",
   916	    backgroundColor: Colors.card,
   917	  },
   918	  inlineErrorTextBlock: { flex: 1, gap: 3 },
   919	  inlineErrorTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.text },
   920	  inlineErrorMessage: {
   921	    fontSize: 13,
   922	    fontFamily: "Inter_400Regular",
   923	    color: Colors.textSecondary,
   924	    lineHeight: 18,
   925	  },
   926	  inlineErrorAction: {
   927	    alignSelf: "center",
   928	    borderRadius: 999,
   929	    backgroundColor: Colors.card,
   930	    borderWidth: 1,
   931	    borderColor: Colors.border,
   932	    paddingHorizontal: 12,
   933	    paddingVertical: 8,
   934	  },
   935	  inlineErrorActionText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.accent },
   936	
   937	  offeringsErrorContainer: {
   938	    flex: 1,
   939	    alignItems: "center",
   940	    justifyContent: "center",
   941	    paddingHorizontal: 32,
   942	    gap: 14,
   943	  },
   944	  offeringsErrorIcon: {
   945	    width: 64,
   946	    height: 64,
   947	    borderRadius: 32,
   948	    backgroundColor: Colors.card,
   949	    alignItems: "center",
   950	    justifyContent: "center",
   951	    borderWidth: 1,
   952	    borderColor: Colors.border,
   953	  },
   954	  offeringsErrorTitle: {
   955	    fontSize: 22,
   956	    fontFamily: "Inter_700Bold",
   957	    color: Colors.text,
   958	    textAlign: "center",
   959	  },
   960	  offeringsErrorText: {
   961	    fontSize: 15,
   962	    fontFamily: "Inter_400Regular",
   963	    color: Colors.textSecondary,
   964	    textAlign: "center",
   965	    lineHeight: 22,
   966	  },
   967	  offeringsRetryBtn: {
   968	    marginTop: 8,
   969	    backgroundColor: Colors.accent,
   970	    borderRadius: 14,
   971	    paddingHorizontal: 20,
   972	    paddingVertical: 13,
   973	  },
   974	  offeringsRetryText: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.textInverse },
   975	});
```

### B3. All Paywall presentation call sites — context passed?

```
app/(tabs)/home-tab.tsx-74-  const { user, profile } = useAuth();
app/(tabs)/home-tab.tsx-75-  const webTopPad = Platform.OS === "web" ? 67 : 0;
app/(tabs)/home-tab.tsx:76:  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/home-tab.tsx-77-
app/(tabs)/home-tab.tsx-78-  const { data: properties, isLoading, refetch } = useQuery({
app/(tabs)/home-tab.tsx-79-    queryKey: ["properties", user?.id],
app/(tabs)/home-tab.tsx-80-    queryFn: async () => {
app/(tabs)/home-tab.tsx-81-      if (!user) return [];
app/(tabs)/home-tab.tsx-82-      const { data } = await supabase
app/(tabs)/home-tab.tsx-83-        .from("properties")
app/(tabs)/home-tab.tsx-84-        .select("*")
--
app/(tabs)/home-tab.tsx-180-                onPress={() => {
app/(tabs)/home-tab.tsx-181-                  if (isLocked) {
app/(tabs)/home-tab.tsx:182:                    setShowPaywall(true);
app/(tabs)/home-tab.tsx-183-                    return;
app/(tabs)/home-tab.tsx-184-                  }
app/(tabs)/home-tab.tsx-185-                  router.push(`/property/${p.id}` as any);
app/(tabs)/home-tab.tsx-186-                  Haptics.selectionAsync();
app/(tabs)/home-tab.tsx-187-                }}
app/(tabs)/home-tab.tsx-188-              >
app/(tabs)/home-tab.tsx-189-                <Ionicons name={icon as any} size={18} color={Colors.home} />
app/(tabs)/home-tab.tsx-190-
--
app/(tabs)/home-tab.tsx-206-      </ScrollView>
app/(tabs)/home-tab.tsx-207-
app/(tabs)/home-tab.tsx:208:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/home-tab.tsx:209:        <Paywall
app/(tabs)/home-tab.tsx-210-          canDismiss
app/(tabs)/home-tab.tsx-211-          showSkip={false}
app/(tabs)/home-tab.tsx-212-          subtitle="Adding more properties requires Pro."
app/(tabs)/home-tab.tsx:213:          onDismiss={() => setShowPaywall(false)}
app/(tabs)/home-tab.tsx-214-        />
app/(tabs)/home-tab.tsx-215-      </Modal>
app/(tabs)/home-tab.tsx-216-    </View>
app/(tabs)/home-tab.tsx-217-  );
app/(tabs)/home-tab.tsx-218-}
app/(tabs)/home-tab.tsx-219-
app/(tabs)/home-tab.tsx-220-function PropertyCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
app/(tabs)/home-tab.tsx-221-  return (
--
app/subscription.tsx-5-export default function SubscriptionScreen() {
app/subscription.tsx-6-  return (
app/subscription.tsx:7:    <Paywall
app/subscription.tsx-8-      canDismiss
app/subscription.tsx-9-      showSkip={false}
app/subscription.tsx-10-      onDismiss={() => router.back()}
app/subscription.tsx-11-    />
app/subscription.tsx-12-  );
app/subscription.tsx-13-}
--
components/Paywall.tsx-128-  const [toastIsError, setToastIsError] = useState(false);
components/Paywall.tsx-129-  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
components/Paywall.tsx:130:  const [inlineError, setInlineError] = useState<PaywallInlineError | null>(null);
components/Paywall.tsx-131-  const purchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
components/Paywall.tsx-132-  const latestProfileTierRef = useRef<string | null>(profile?.subscription_tier ?? null);
components/Paywall.tsx-133-  useEffect(() => {
components/Paywall.tsx-134-    latestProfileTierRef.current = profile?.subscription_tier ?? null;
components/Paywall.tsx-135-  }, [profile?.subscription_tier]);
components/Paywall.tsx-136-
components/Paywall.tsx-137-  useEffect(() => {
components/Paywall.tsx-138-    return () => {
--
app/add-property.tsx-154-  const [error, setError] = useState<string | null>(null);
app/add-property.tsx-155-  const [statePickerVisible, setStatePickerVisible] = useState(false);
app/add-property.tsx:156:  const [showPaywall, setShowPaywall] = useState(false);
app/add-property.tsx-157-
app/add-property.tsx-158-  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
app/add-property.tsx-159-  const [showSuggestions, setShowSuggestions] = useState(false);
app/add-property.tsx-160-  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
app/add-property.tsx-161-  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
app/add-property.tsx-162-
app/add-property.tsx-163-  const [isLookingUpProperty, setIsLookingUpProperty] = useState(false);
app/add-property.tsx-164-  const [propertyAutoFilled, setPropertyAutoFilled] = useState(false);
--
app/add-property.tsx-279-      if ((count ?? 0) >= propertyLimit(profile)) {
app/add-property.tsx-280-        setIsLoading(false);
app/add-property.tsx:281:        setShowPaywall(true);
app/add-property.tsx-282-        return;
app/add-property.tsx-283-      }
app/add-property.tsx-284-    } catch {}
app/add-property.tsx-285-
app/add-property.tsx-286-    const streetLine = unit.trim() ? `${street.trim()} ${unit.trim()}` : street.trim();
app/add-property.tsx-287-    const cityStateZip = [city.trim(), [stateCode, zip.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
app/add-property.tsx-288-    const fullAddress = [streetLine, cityStateZip].filter(Boolean).join(", ");
app/add-property.tsx-289-    const name = nickname.trim() || `${TYPE_LABELS[propertyType] ?? "Property"}: ${street.trim()}`;
--
app/add-property.tsx-572-      />
app/add-property.tsx-573-      <SaveToast visible={showToast} message="Property saved!" />
app/add-property.tsx:574:      {showPaywall && (
app/add-property.tsx:575:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-property.tsx:576:          <Paywall
app/add-property.tsx-577-            canDismiss
app/add-property.tsx-578-            subtitle="Upgrade to add more properties"
app/add-property.tsx:579:            onDismiss={() => setShowPaywall(false)}
app/add-property.tsx-580-          />
app/add-property.tsx-581-        </Modal>
app/add-property.tsx-582-      )}
app/add-property.tsx-583-    </KeyboardAvoidingView>
app/add-property.tsx-584-  );
app/add-property.tsx-585-}
app/add-property.tsx-586-
app/add-property.tsx-587-function StatePickerModal({ visible, selected, onSelect, onClose, insets }: {
--
app/(tabs)/health.tsx-84-  const [toastIsError, setToastIsError] = useState(false);
app/(tabs)/health.tsx-85-  const [paywallSubtitle, setPaywallSubtitle] = useState("Upgrade to unlock more family tracking.");
app/(tabs)/health.tsx:86:  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/health.tsx-87-
app/(tabs)/health.tsx-88-  function showToast(msg: string, isError = false) {
app/(tabs)/health.tsx-89-    setToastMsg(msg);
app/(tabs)/health.tsx-90-    setToastIsError(isError);
app/(tabs)/health.tsx-91-    setToastVisible(true);
app/(tabs)/health.tsx-92-    setTimeout(() => setToastVisible(false), 2800);
app/(tabs)/health.tsx-93-  }
app/(tabs)/health.tsx-94-
--
app/(tabs)/health.tsx-413-  function openPlanUpsell(subtitle: string) {
app/(tabs)/health.tsx-414-    setPaywallSubtitle(subtitle);
app/(tabs)/health.tsx:415:    setShowPaywall(true);
app/(tabs)/health.tsx-416-  }
app/(tabs)/health.tsx-417-
app/(tabs)/health.tsx-418-  function openAddPerson() {
app/(tabs)/health.tsx-419-    const currentPeople = familyMembers?.filter(fm => fm.member_type !== "pet").length ?? 0;
app/(tabs)/health.tsx-420-    const maxPeople = personLimit(profile);
app/(tabs)/health.tsx-421-    if (currentPeople >= maxPeople) {
app/(tabs)/health.tsx-422-      openPlanUpsell("Adding more people requires Pro.");
app/(tabs)/health.tsx-423-      return;
--
app/(tabs)/health.tsx-769-      </ScrollView>
app/(tabs)/health.tsx-770-
app/(tabs)/health.tsx:771:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/health.tsx:772:        <Paywall
app/(tabs)/health.tsx-773-          canDismiss
app/(tabs)/health.tsx-774-          showSkip={false}
app/(tabs)/health.tsx-775-          subtitle={paywallSubtitle}
app/(tabs)/health.tsx:776:          onDismiss={() => setShowPaywall(false)}
app/(tabs)/health.tsx-777-        />
app/(tabs)/health.tsx-778-      </Modal>
app/(tabs)/health.tsx-779-
app/(tabs)/health.tsx-780-      <SaveToast visible={toastVisible} message={toastMsg} isError={toastIsError} />
app/(tabs)/health.tsx-781-
app/(tabs)/health.tsx-782-      <Modal
app/(tabs)/health.tsx-783-        visible={markCompleteAppt != null}
app/(tabs)/health.tsx-784-        transparent
--
app/(tabs)/vehicles.tsx-73-  const { user, profile } = useAuth();
app/(tabs)/vehicles.tsx-74-  const webTopPad = Platform.OS === "web" ? 67 : 0;
app/(tabs)/vehicles.tsx:75:  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/vehicles.tsx-76-
app/(tabs)/vehicles.tsx-77-  const { data: vehicles, isLoading, refetch } = useQuery({
app/(tabs)/vehicles.tsx-78-    queryKey: ["vehicles", user?.id],
app/(tabs)/vehicles.tsx-79-    queryFn: async () => {
app/(tabs)/vehicles.tsx-80-      if (!user) return [];
app/(tabs)/vehicles.tsx-81-      const { data } = await supabase
app/(tabs)/vehicles.tsx-82-        .from("vehicles")
app/(tabs)/vehicles.tsx-83-        .select("*")
--
app/(tabs)/vehicles.tsx-228-                onPress={() => {
app/(tabs)/vehicles.tsx-229-                  if (isLocked) {
app/(tabs)/vehicles.tsx:230:                    setShowPaywall(true);
app/(tabs)/vehicles.tsx-231-                    return;
app/(tabs)/vehicles.tsx-232-                  }
app/(tabs)/vehicles.tsx-233-                  router.push(`/vehicle/${v.id}` as any);
app/(tabs)/vehicles.tsx-234-                  Haptics.selectionAsync();
app/(tabs)/vehicles.tsx-235-                }}
app/(tabs)/vehicles.tsx-236-              >
app/(tabs)/vehicles.tsx-237-                {v.photo_url ? (
app/(tabs)/vehicles.tsx-238-                  <Image source={{ uri: v.photo_url }} style={{ width: 36, height: 36, borderRadius: 10 }} resizeMode="cover" />
--
app/(tabs)/vehicles.tsx-274-      </ScrollView>
app/(tabs)/vehicles.tsx-275-
app/(tabs)/vehicles.tsx:276:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/vehicles.tsx:277:        <Paywall
app/(tabs)/vehicles.tsx-278-          canDismiss
app/(tabs)/vehicles.tsx-279-          showSkip={false}
app/(tabs)/vehicles.tsx-280-          subtitle="Adding more vehicles requires Pro."
app/(tabs)/vehicles.tsx:281:          onDismiss={() => setShowPaywall(false)}
app/(tabs)/vehicles.tsx-282-        />
app/(tabs)/vehicles.tsx-283-      </Modal>
app/(tabs)/vehicles.tsx-284-    </View>
app/(tabs)/vehicles.tsx-285-  );
app/(tabs)/vehicles.tsx-286-}
app/(tabs)/vehicles.tsx-287-
app/(tabs)/vehicles.tsx-288-function VehicleCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
app/(tabs)/vehicles.tsx-289-  return (
--
app/log-service/[vehicleId].tsx-52-  const scrollRef = useRef<any>(null);
app/log-service/[vehicleId].tsx-53-  const scrollOffset = useRef(0);
app/log-service/[vehicleId].tsx:54:  const [showPaywall, setShowPaywall] = useState(false);
app/log-service/[vehicleId].tsx-55-  const [showScanPackModal, setShowScanPackModal] = useState(false);
app/log-service/[vehicleId].tsx-56-  const [task, setTask] = useState("");
app/log-service/[vehicleId].tsx-57-  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
app/log-service/[vehicleId].tsx-58-  const [mileage, setMileage] = useState("");
app/log-service/[vehicleId].tsx-59-  const [cost, setCost] = useState("");
app/log-service/[vehicleId].tsx-60-  const [provider, setProvider] = useState("");
app/log-service/[vehicleId].tsx-61-  const [notes, setNotes] = useState("");
app/log-service/[vehicleId].tsx-62-  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
--
app/log-service/[vehicleId].tsx-452-                onPress={() => {
app/log-service/[vehicleId].tsx-453-                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
app/log-service/[vehicleId].tsx:454:                  setShowPaywall(true);
app/log-service/[vehicleId].tsx-455-                }}
app/log-service/[vehicleId].tsx-456-              >
app/log-service/[vehicleId].tsx-457-                <Ionicons name="camera-outline" size={16} color={Colors.accent} />
app/log-service/[vehicleId].tsx-458-                <Text style={styles.scanGateBtnText}>Scan Receipt</Text>
app/log-service/[vehicleId].tsx-459-                <View style={styles.scanLockedBadge}>
app/log-service/[vehicleId].tsx-460-                  <Ionicons name="lock-closed" size={10} color={Colors.textInverse} />
app/log-service/[vehicleId].tsx-461-                  <Text style={styles.scanLockedText}>Upgrade</Text>
app/log-service/[vehicleId].tsx-462-                </View>
--
app/log-service/[vehicleId].tsx-467-                assetId={vehicleId}
app/log-service/[vehicleId].tsx-468-                onScanComplete={handleScanComplete}
app/log-service/[vehicleId].tsx:469:                onScanLimitReached={() => setShowPaywall(true)}
app/log-service/[vehicleId].tsx-470-                onPaidUserAtCap={() => setShowScanPackModal(true)}
app/log-service/[vehicleId].tsx-471-              />
app/log-service/[vehicleId].tsx-472-            )}
app/log-service/[vehicleId].tsx-473-          </View>
app/log-service/[vehicleId].tsx-474-
app/log-service/[vehicleId].tsx-475-          {scannedItems.length > 0 && (
app/log-service/[vehicleId].tsx-476-            <View style={styles.fieldGroup}>
app/log-service/[vehicleId].tsx-477-              <Text style={styles.groupLabel}>Services Found ({scannedItems.length})</Text>
--
app/log-service/[vehicleId].tsx-690-        </ScrollView>
app/log-service/[vehicleId].tsx-691-      </View>
app/log-service/[vehicleId].tsx:692:      {showPaywall && (
app/log-service/[vehicleId].tsx:693:        <Modal visible animationType="slide" onRequestClose={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}>
app/log-service/[vehicleId].tsx:694:          <Paywall
app/log-service/[vehicleId].tsx-695-            canDismiss
app/log-service/[vehicleId].tsx-696-            subtitle="Upgrade to scan receipts with AI"
app/log-service/[vehicleId].tsx:697:            onDismiss={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
app/log-service/[vehicleId].tsx-698-          />
app/log-service/[vehicleId].tsx-699-        </Modal>
app/log-service/[vehicleId].tsx-700-      )}
app/log-service/[vehicleId].tsx-701-      <ScanPackModal
app/log-service/[vehicleId].tsx-702-        visible={showScanPackModal}
app/log-service/[vehicleId].tsx-703-        onClose={() => setShowScanPackModal(false)}
app/log-service/[vehicleId].tsx-704-        onSuccess={() => setShowScanPackModal(false)}
app/log-service/[vehicleId].tsx-705-      />
--
app/add-vehicle.tsx-616-  const [error, setError] = useState<string | null>(null);
app/add-vehicle.tsx-617-  const [submitted, setSubmitted] = useState(false);
app/add-vehicle.tsx:618:  const [showPaywall, setShowPaywall] = useState(false);
app/add-vehicle.tsx-619-  const [showCopyModal, setShowCopyModal] = useState(false);
app/add-vehicle.tsx-620-  const [savedVehicleId, setSavedVehicleId] = useState<string | null>(null);
app/add-vehicle.tsx-621-
app/add-vehicle.tsx-622-  const [vin, setVin] = useState("");
app/add-vehicle.tsx-623-  const [isVinLoading, setIsVinLoading] = useState(false);
app/add-vehicle.tsx-624-  const [vinError, setVinError] = useState<string | null>(null);
app/add-vehicle.tsx-625-  const [vinSuccess, setVinSuccess] = useState<string | null>(null);
app/add-vehicle.tsx-626-  const [engineSize, setEngineSize] = useState<string | null>(null);
--
app/add-vehicle.tsx-975-        .eq("user_id", user.id);
app/add-vehicle.tsx-976-      if ((count ?? 0) >= vehicleLimit(profile)) {
app/add-vehicle.tsx:977:        setShowPaywall(true);
app/add-vehicle.tsx-978-        return;
app/add-vehicle.tsx-979-      }
app/add-vehicle.tsx-980-    } catch {}
app/add-vehicle.tsx-981-
app/add-vehicle.tsx-982-    const hasCandidates = walletCandidates && walletCandidates.length > 0;
app/add-vehicle.tsx-983-    const inferredMode = isOnboarding ? "mileage" : inferTrackingMode(selectedVehicleCategory);
app/add-vehicle.tsx-984-    const vehicleData = isOnboarding
app/add-vehicle.tsx-985-      ? {
--
app/add-vehicle.tsx-2168-        </View>
app/add-vehicle.tsx-2169-      </Modal>
app/add-vehicle.tsx:2170:      {showPaywall && (
app/add-vehicle.tsx:2171:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-vehicle.tsx:2172:          <Paywall
app/add-vehicle.tsx-2173-            canDismiss
app/add-vehicle.tsx-2174-            subtitle="Upgrade to add more vehicles"
app/add-vehicle.tsx:2175:            onDismiss={() => setShowPaywall(false)}
app/add-vehicle.tsx-2176-          />
app/add-vehicle.tsx-2177-        </Modal>
app/add-vehicle.tsx-2178-      )}
app/add-vehicle.tsx-2179-
app/add-vehicle.tsx-2180-      <CopyFromVehicleModal
app/add-vehicle.tsx-2181-        visible={showCopyModal}
app/add-vehicle.tsx-2182-        newVehicleId={savedVehicleId}
app/add-vehicle.tsx-2183-        userId={user?.id ?? ""}
--
app/vehicle/[id].tsx-129-  const [activeTab, setActiveTab] = useState<"schedule" | "wallet" | "history">("schedule");
app/vehicle/[id].tsx-130-  const [isExporting, setIsExporting] = useState(false);
app/vehicle/[id].tsx:131:  const [showPaywall, setShowPaywall] = useState(false);
app/vehicle/[id].tsx-132-  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false);
app/vehicle/[id].tsx-133-  const [scheduleRefreshing, setScheduleRefreshing] = useState(false);
app/vehicle/[id].tsx-134-  const [actionNeededExpanded, setActionNeededExpanded] = useState(true);
app/vehicle/[id].tsx-135-  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
app/vehicle/[id].tsx-136-  const [completedExpanded, setCompletedExpanded] = useState(false);
app/vehicle/[id].tsx-137-  const [generatingSchedule, setGeneratingSchedule] = useState(false);
app/vehicle/[id].tsx-138-  const [refreshingSchedule, setRefreshingSchedule] = useState(false);
app/vehicle/[id].tsx-139-  const [vehicleScheduleBannerVisible, setVehicleScheduleBannerVisible] = useState(false);
--
app/vehicle/[id].tsx-1042-  function handleExport() {
app/vehicle/[id].tsx-1043-    if (!hasPersonalOrAbove(profile)) {
app/vehicle/[id].tsx:1044:      setShowPaywall(true);
app/vehicle/[id].tsx-1045-      return;
app/vehicle/[id].tsx-1046-    }
app/vehicle/[id].tsx-1047-    Alert.alert("Export Service History", "Choose a format for resale documentation", [
app/vehicle/[id].tsx-1048-      { text: "PDF", onPress: () => exportHistory("pdf") },
app/vehicle/[id].tsx-1049-      { text: "CSV", onPress: () => exportHistory("csv") },
app/vehicle/[id].tsx-1050-      { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-1051-    ]);
app/vehicle/[id].tsx-1052-  }
--
app/vehicle/[id].tsx-1694-      </Modal>
app/vehicle/[id].tsx-1695-
app/vehicle/[id].tsx:1696:      {showPaywall && (
app/vehicle/[id].tsx:1697:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/vehicle/[id].tsx:1698:          <Paywall
app/vehicle/[id].tsx-1699-            canDismiss
app/vehicle/[id].tsx-1700-            subtitle="Upgrade to export your service history"
app/vehicle/[id].tsx:1701:            onDismiss={() => setShowPaywall(false)}
app/vehicle/[id].tsx-1702-          />
app/vehicle/[id].tsx-1703-        </Modal>
app/vehicle/[id].tsx-1704-      )}
app/vehicle/[id].tsx-1705-    </View>
app/vehicle/[id].tsx-1706-  );
app/vehicle/[id].tsx-1707-}
app/vehicle/[id].tsx-1708-
app/vehicle/[id].tsx-1709-function ScheduleSkeleton() {
--
app/add-family-member.tsx-43-  const [error, setError] = useState<string | null>(null);
app/add-family-member.tsx-44-  const [showToast, setShowToast] = useState(false);
app/add-family-member.tsx:45:  const [showPaywall, setShowPaywall] = useState(false);
app/add-family-member.tsx-46-
app/add-family-member.tsx-47-  function formatDob(text: string) {
app/add-family-member.tsx-48-    const digits = text.replace(/\D/g, "");
app/add-family-member.tsx-49-    if (digits.length <= 2) return digits;
app/add-family-member.tsx-50-    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
app/add-family-member.tsx-51-    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
app/add-family-member.tsx-52-  }
app/add-family-member.tsx-53-
--
app/add-family-member.tsx-68-      const petsCount = existing?.filter((r: { member_type: string }) => r.member_type === "pet").length ?? 0;
app/add-family-member.tsx-69-      if (memberType === "person" && peopleCount >= personLimit(profile)) {
app/add-family-member.tsx:70:        setShowPaywall(true);
app/add-family-member.tsx-71-        return;
app/add-family-member.tsx-72-      }
app/add-family-member.tsx-73-      if (memberType === "pet" && petsCount >= petLimit(profile)) {
app/add-family-member.tsx:74:        setShowPaywall(true);
app/add-family-member.tsx-75-        return;
app/add-family-member.tsx-76-      }
app/add-family-member.tsx-77-    } catch {}
app/add-family-member.tsx-78-    setIsLoading(true);
app/add-family-member.tsx-79-    setError(null);
app/add-family-member.tsx-80-
app/add-family-member.tsx-81-    let dateOfBirth: string | null = null;
app/add-family-member.tsx-82-    if (dob && dob.length === 10) {
--
app/add-family-member.tsx-200-      </View>
app/add-family-member.tsx-201-      <SaveToast visible={showToast} message="Member saved!" />
app/add-family-member.tsx:202:      {showPaywall && (
app/add-family-member.tsx:203:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-family-member.tsx:204:          <Paywall
app/add-family-member.tsx-205-            canDismiss
app/add-family-member.tsx-206-            subtitle="Upgrade to add unlimited family members"
app/add-family-member.tsx:207:            onDismiss={() => setShowPaywall(false)}
app/add-family-member.tsx-208-          />
app/add-family-member.tsx-209-        </Modal>
app/add-family-member.tsx-210-      )}
app/add-family-member.tsx-211-    </KeyboardAvoidingView>
app/add-family-member.tsx-212-  );
app/add-family-member.tsx-213-}
app/add-family-member.tsx-214-
app/add-family-member.tsx-215-const styles = StyleSheet.create({
```

### B4. All G6.11 Locked / Limit-Reached call sites

```
(no matches)
```

### B5. Modal vs bottom-sheet usage (HIG audit)

```
app/add-property.tsx:575:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-property.tsx:595:    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
components/LogSheet.tsx:659:    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
components/ScanPackModal.tsx:108:    <Modal
components/ErrorFallback.tsx:119:        <Modal
app/log-service/[vehicleId].tsx:693:        <Modal visible animationType="slide" onRequestClose={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}>
components/DatePicker.tsx:2:import { View, Text, Pressable, Platform, Modal, StyleSheet } from "react-native";
components/DatePicker.tsx:40:        <Modal transparent animationType="slide" onRequestClose={() => { setShow(false); onClose?.(); }}>
app/property-task-history/[propertyId].tsx:242:      <Modal
app/property/[id].tsx:857:      <Modal
app/add-family-member.tsx:203:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/vehicle-task-history/[vehicleId].tsx:295:      <Modal
app/add-vehicle.tsx:489:    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
app/add-vehicle.tsx:1396:                <Modal
app/add-vehicle.tsx:2116:      <Modal
app/add-vehicle.tsx:2171:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-vehicle.tsx:2230:    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
app/add-vehicle.tsx:2364:    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
app/add-vehicle.tsx:2444:    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
app/(tabs)/home-tab.tsx:208:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/vehicles.tsx:276:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/vehicle/[id].tsx:1635:      <Modal
app/vehicle/[id].tsx:1697:        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/vehicle/[id].tsx:2004:    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
app/vehicle/[id].tsx:2258:    <Modal
app/vehicle/[id].tsx:2698:      <Modal
app/(tabs)/health.tsx:771:      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
app/(tabs)/health.tsx:782:      <Modal
```

### B6. Haptics on paid surfaces

```
components/ScanPackModal.tsx:49:      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
components/ScanPackModal.tsx:53:    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
components/ScanPackModal.tsx:88:      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/ScanPackModal.tsx:98:        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
components/Paywall.tsx:173:        ? Haptics.NotificationFeedbackType.Warning
components/Paywall.tsx:174:        : Haptics.NotificationFeedbackType.Error;
components/Paywall.tsx:175:    Haptics.notificationAsync(feedbackType).catch(() => {});
components/Paywall.tsx:214:    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
components/Paywall.tsx:291:          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/Paywall.tsx:303:            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/Paywall.tsx:356:    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
components/Paywall.tsx:391:      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/Paywall.tsx:421:        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
components/Paywall.tsx:428:        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
components/Paywall.tsx:436:      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/Paywall.tsx:532:                onPress={() => { setBilling(b); Haptics.selectionAsync(); }}
components/Paywall.tsx:561:                  onPress={() => { setSelectedTier(tier); Haptics.selectionAsync(); }}
```

### B7. Subscription management, renewal, cancellation, and trial surfaces

```
app/terms-of-service.tsx-28-  },
app/terms-of-service.tsx-29-  {
app/terms-of-service.tsx-30-    title: "6. Subscriptions and Billing",
app/terms-of-service.tsx:31:    body: "Subscriptions are billed through the Apple App Store. Pricing is presented before purchase. Subscriptions renew automatically unless canceled. You can manage or cancel subscriptions through your Apple account. Refunds are handled by Apple, not LifeMaintained.",
app/terms-of-service.tsx-32-  },
app/terms-of-service.tsx-33-  {
app/terms-of-service.tsx-34-    title: "7. User Content",
app/terms-of-service.tsx-35-    body: "You retain ownership of content you submit. You grant LifeMaintained a limited license to use it solely to operate, maintain, and improve the Service.",
app/terms-of-service.tsx-36-  },
app/terms-of-service.tsx-37-  {
app/terms-of-service.tsx-38-    title: "8. DMCA and Copyright",
app/terms-of-service.tsx-39-    body: "If you believe content on the Service infringes your copyright, you may submit a notice to our designated agent at support@lifemaintained.com. Your notice must include: identification of the copyrighted work, identification of the infringing material, your contact information, a statement of good faith belief that the use is unauthorized, a statement under penalty of perjury that the information is accurate, and your physical or electronic signature. We will respond to valid notices in accordance with the Digital Millennium Copyright Act.",
app/terms-of-service.tsx-40-  },
app/terms-of-service.tsx-41-  {
app/terms-of-service.tsx-42-    title: "9. Prohibited Use",
app/terms-of-service.tsx-43-    body: "You may not use the Service for unlawful activity, attempt to reverse engineer or disrupt the Service, or access or scrape data without authorization.",
--
components/LogSheet.tsx-34-  withDelay,
components/LogSheet.tsx-35-  withSpring,
components/LogSheet.tsx-36-  useAnimatedStyle,
components/LogSheet.tsx:37:  cancelAnimation,
components/LogSheet.tsx-38-  Easing as ReaEasing,
components/LogSheet.tsx-39-} from "react-native-reanimated";
components/LogSheet.tsx-40-
components/LogSheet.tsx-41-type RecordPhase =
components/LogSheet.tsx-42-  | "idle"
components/LogSheet.tsx-43-  | "recording"
components/LogSheet.tsx-44-  | "transcribing"
components/LogSheet.tsx-45-  | "type"
components/LogSheet.tsx-46-  | "processing"
components/LogSheet.tsx-47-  | "results"
components/LogSheet.tsx-48-  | "error";
components/LogSheet.tsx-49-
--
components/LogSheet.tsx-117-  // Freeze pulse rings when transcribing (Bug 2 fix)
components/LogSheet.tsx-118-  useEffect(() => {
components/LogSheet.tsx-119-    if (phase === "transcribing") {
components/LogSheet.tsx:120:      [r1s, r2s, r3s, r4s].forEach(sv => cancelAnimation(sv));
components/LogSheet.tsx-121-      [r1o, r2o, r3o, r4o].forEach(sv => {
components/LogSheet.tsx:122:        cancelAnimation(sv);
components/LogSheet.tsx-123-        sv.value = withTiming(0, { duration: 300 });
components/LogSheet.tsx-124-      });
components/LogSheet.tsx-125-    }
components/LogSheet.tsx-126-  }, [phase]);
components/LogSheet.tsx-127-
components/LogSheet.tsx-128-  // Amplitude → inner core scale + outer glow intensity
components/LogSheet.tsx-129-  useEffect(() => {
components/LogSheet.tsx-130-    if (!isRecording) {
components/LogSheet.tsx-131-      coreScale.value   = withSpring(1.0, { damping: 15, stiffness: 150 });
components/LogSheet.tsx-132-      outerOpacity.value = withTiming(0.06, { duration: 400 });
components/LogSheet.tsx-133-      return;
components/LogSheet.tsx-134-    }
--
app/add-property.tsx-2-import { useFocusEffect } from "expo-router";
app/add-property.tsx-3-import { SaveToast } from "@/components/SaveToast";
app/add-property.tsx-4-import Paywall from "@/components/Paywall";
app/add-property.tsx:5:import { propertyLimit } from "@/lib/subscription";
app/add-property.tsx-6-import {
app/add-property.tsx-7-  View,
app/add-property.tsx-8-  Text,
app/add-property.tsx-9-  TextInput,
app/add-property.tsx-10-  Pressable,
app/add-property.tsx-11-  StyleSheet,
app/add-property.tsx-12-  ScrollView,
app/add-property.tsx-13-  FlatList,
app/add-property.tsx-14-  Platform,
app/add-property.tsx-15-  ActivityIndicator,
app/add-property.tsx-16-  Modal,
app/add-property.tsx-17-  Keyboard,
--
components/ScanPackModal.tsx-167-        })}
components/ScanPackModal.tsx-168-
components/ScanPackModal.tsx-169-        <Pressable
components/ScanPackModal.tsx:170:          style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
components/ScanPackModal.tsx-171-          onPress={onClose}
components/ScanPackModal.tsx-172-        >
components/ScanPackModal.tsx:173:          <Text style={styles.cancelText}>Cancel</Text>
components/ScanPackModal.tsx-174-        </Pressable>
components/ScanPackModal.tsx-175-
components/ScanPackModal.tsx-176-        <SaveToast visible={toastVisible} message="Scans added to your account" />
components/ScanPackModal.tsx-177-      </View>
components/ScanPackModal.tsx-178-    </Modal>
components/ScanPackModal.tsx-179-  );
components/ScanPackModal.tsx-180-}
components/ScanPackModal.tsx-181-
components/ScanPackModal.tsx-182-const styles = StyleSheet.create({
components/ScanPackModal.tsx-183-  overlay: {
components/ScanPackModal.tsx-184-    flex: 1,
components/ScanPackModal.tsx-185-    backgroundColor: "rgba(0,0,0,0.5)",
--
components/ScanPackModal.tsx-247-  packTitle: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary, flex: 1 },
components/ScanPackModal.tsx-248-  packRight: { minWidth: 52, alignItems: "flex-end" },
components/ScanPackModal.tsx-249-  packPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.text },
components/ScanPackModal.tsx:250:  cancelBtn: { alignItems: "center", paddingVertical: 8 },
components/ScanPackModal.tsx:251:  cancelText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
components/ScanPackModal.tsx-252-  errorCard: {
components/ScanPackModal.tsx-253-    flexDirection: "row",
components/ScanPackModal.tsx-254-    gap: 8,
components/ScanPackModal.tsx-255-    alignItems: "center",
components/ScanPackModal.tsx-256-    backgroundColor: Colors.card,
components/ScanPackModal.tsx-257-    borderWidth: 1,
components/ScanPackModal.tsx-258-    borderColor: Colors.overdue,
components/ScanPackModal.tsx-259-    borderRadius: 12,
components/ScanPackModal.tsx-260-    paddingHorizontal: 12,
components/ScanPackModal.tsx-261-    paddingVertical: 10,
components/ScanPackModal.tsx-262-  },
components/ScanPackModal.tsx-263-  errorText: {
--
components/TrialBanner.tsx-4-import { Ionicons } from "@expo/vector-icons";
components/TrialBanner.tsx-5-import { Colors } from "@/constants/colors";
components/TrialBanner.tsx-6-import { useAuth } from "@/context/AuthContext";
components/TrialBanner.tsx:7:import { isInTrial, trialDaysRemaining } from "@/lib/subscription";
components/TrialBanner.tsx-8-import * as Haptics from "expo-haptics";
components/TrialBanner.tsx-9-
components/TrialBanner.tsx-10-export default function TrialBanner() {
components/TrialBanner.tsx-11-  const { profile } = useAuth();
components/TrialBanner.tsx-12-  const opacity = useRef(new Animated.Value(0)).current;
components/TrialBanner.tsx-13-  const translateY = useRef(new Animated.Value(-12)).current;
components/TrialBanner.tsx-14-  const prevVisible = useRef(false);
components/TrialBanner.tsx-15-
components/TrialBanner.tsx:16:  const daysLeft = trialDaysRemaining(profile);
components/TrialBanner.tsx-17-  const inTrial = isInTrial(profile);
components/TrialBanner.tsx-18-  const shouldShow = inTrial && daysLeft <= 7;
components/TrialBanner.tsx-19-
components/TrialBanner.tsx-20-  useEffect(() => {
components/TrialBanner.tsx-21-    if (shouldShow && !prevVisible.current) {
components/TrialBanner.tsx-22-      prevVisible.current = true;
components/TrialBanner.tsx-23-      Animated.parallel([
components/TrialBanner.tsx-24-        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
components/TrialBanner.tsx-25-        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
components/TrialBanner.tsx-26-      ]).start();
components/TrialBanner.tsx-27-    } else if (!shouldShow && prevVisible.current) {
components/TrialBanner.tsx-28-      prevVisible.current = false;
--
components/TrialBanner.tsx-44-        style={styles.inner}
components/TrialBanner.tsx-45-        onPress={() => {
components/TrialBanner.tsx-46-          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
components/TrialBanner.tsx:47:          router.push("/subscription");
components/TrialBanner.tsx-48-        }}
components/TrialBanner.tsx-49-      >
components/TrialBanner.tsx-50-        <View style={styles.left}>
components/TrialBanner.tsx-51-          <Ionicons name="time-outline" size={16} color={Colors.accent} />
components/TrialBanner.tsx-52-          <Text style={styles.text}>
components/TrialBanner.tsx-53-            <Text style={styles.bold}>{daysLeft} day{daysLeft !== 1 ? "s" : ""}</Text>
components/TrialBanner.tsx:54:            {" left in your free trial"}
components/TrialBanner.tsx-55-          </Text>
components/TrialBanner.tsx-56-        </View>
components/TrialBanner.tsx-57-        <View style={styles.cta}>
components/TrialBanner.tsx-58-          <Text style={styles.ctaText}>Upgrade</Text>
components/TrialBanner.tsx-59-          <Ionicons name="chevron-forward" size={12} color={Colors.accent} />
components/TrialBanner.tsx-60-        </View>
components/TrialBanner.tsx-61-      </Pressable>
components/TrialBanner.tsx-62-    </Animated.View>
components/TrialBanner.tsx-63-  );
components/TrialBanner.tsx-64-}
components/TrialBanner.tsx-65-
components/TrialBanner.tsx-66-const styles = StyleSheet.create({
--
components/Paywall.tsx-111-}: PaywallProps) {
components/Paywall.tsx-112-  const insets = useSafeAreaInsets();
components/Paywall.tsx-113-  const { user, profile, refreshProfile } = useAuth();
components/Paywall.tsx:114:  const [billing, setBilling] = useState<Billing>("annual");
components/Paywall.tsx-115-  const [selectedTier, setSelectedTier] = useState<TierKey>("personal");
components/Paywall.tsx-116-  const [isPurchasing, setIsPurchasing] = useState(false);
components/Paywall.tsx-117-  const [isRestoring, setIsRestoring] = useState(false);
components/Paywall.tsx-118-  const [showPromo, setShowPromo] = useState(false);
components/Paywall.tsx-119-  const [promoCode, setPromoCode] = useState("");
components/Paywall.tsx-120-  const [promoStatus, setPromoStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
components/Paywall.tsx-121-  const [promoMessage, setPromoMessage] = useState<string | null>(null);
components/Paywall.tsx-122-  const [loadedOfferings, setLoadedOfferings] = useState<any | null>(null);
components/Paywall.tsx-123-  const [offeringsError, setOfferingsError] = useState(false);
components/Paywall.tsx-124-  const [loadingOfferings, setLoadingOfferings] = useState(Platform.OS !== "web");
components/Paywall.tsx-125-  const [toastVisible, setToastVisible] = useState(false);
components/Paywall.tsx-126-  const [toastMessage, setToastMessage] = useState("You're in. Trial starts now.");
--
components/Paywall.tsx-129-  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
components/Paywall.tsx-130-  const [inlineError, setInlineError] = useState<PaywallInlineError | null>(null);
components/Paywall.tsx-131-  const purchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
components/Paywall.tsx:132:  const latestProfileTierRef = useRef<string | null>(profile?.subscription_tier ?? null);
components/Paywall.tsx-133-  useEffect(() => {
components/Paywall.tsx:134:    latestProfileTierRef.current = profile?.subscription_tier ?? null;
components/Paywall.tsx:135:  }, [profile?.subscription_tier]);
components/Paywall.tsx-136-
components/Paywall.tsx-137-  useEffect(() => {
components/Paywall.tsx-138-    return () => {
components/Paywall.tsx-139-      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
components/Paywall.tsx-140-    };
components/Paywall.tsx-141-  }, []);
components/Paywall.tsx-142-
components/Paywall.tsx-143-  const waitForWebhookProfileTier = async (expectedTier: string): Promise<boolean> => {
components/Paywall.tsx-144-    for (let i = 0; i < 8; i++) {
components/Paywall.tsx-145-      await refreshProfile();
components/Paywall.tsx-146-      if (latestProfileTierRef.current === expectedTier) return true;
components/Paywall.tsx-147-      if (i < 7) await new Promise(r => setTimeout(r, 1000));
--
components/Paywall.tsx-204-    if (!user || Platform.OS === "web") {
components/Paywall.tsx-205-      showInlineError({
components/Paywall.tsx-206-        title: "Sign in required",
components/Paywall.tsx:207:        message: "Please sign in to start a subscription.",
components/Paywall.tsx-208-        actionLabel: "Try again",
components/Paywall.tsx-209-        onAction: handlePurchase,
components/Paywall.tsx-210-      });
components/Paywall.tsx-211-      return;
components/Paywall.tsx-212-    }
components/Paywall.tsx-213-    setIsPurchasing(true);
components/Paywall.tsx-214-    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
components/Paywall.tsx-215-
components/Paywall.tsx-216-    // Apple sandbox routinely takes >30s and can exceed 120s during
components/Paywall.tsx-217-    // outages. Do not tell the user the purchase failed while purchasePackage
components/Paywall.tsx-218-    // is still in flight.
components/Paywall.tsx-219-    //
--
components/Paywall.tsx-257-        return;
components/Paywall.tsx-258-      }
components/Paywall.tsx-259-
components/Paywall.tsx:260:      const pkg = billing === "annual"
components/Paywall.tsx-261-        ? (offering.annual ?? offering.availablePackages[0])
components/Paywall.tsx-262-        : (offering.monthly ?? offering.availablePackages[0]);
components/Paywall.tsx-263-
components/Paywall.tsx-264-      if (!pkg) {
components/Paywall.tsx-265-        if (purchaseTimeoutRef.current) { clearTimeout(purchaseTimeoutRef.current); purchaseTimeoutRef.current = null; }
components/Paywall.tsx-266-        clearTimeout(purchaseEscapeTimeout);
components/Paywall.tsx-267-        setIsPurchasing(false);
components/Paywall.tsx-268-        showInlineError({
components/Paywall.tsx-269-          title: "Plan unavailable",
components/Paywall.tsx-270-          message: "This plan isn't available right now. Try another plan or check back shortly.",
components/Paywall.tsx-271-          feedback: "warning",
components/Paywall.tsx-272-        });
components/Paywall.tsx-273-        return;
components/Paywall.tsx-274-      }
components/Paywall.tsx-275-
components/Paywall.tsx:276:      const { customerInfo } = await Purchases.purchasePackage(pkg);
components/Paywall.tsx-277-      if (purchaseTimeoutRef.current) clearTimeout(purchaseTimeoutRef.current);
components/Paywall.tsx-278-      clearTimeout(purchaseEscapeTimeout);
components/Paywall.tsx-279-
components/Paywall.tsx:280:      const active = customerInfo?.entitlements?.active ?? {};
components/Paywall.tsx-281-      const tier = active["business_access"] ? "business"
components/Paywall.tsx-282-        : active["pro_access"] ? "pro"
components/Paywall.tsx-283-        : active["personal_access"] ? "personal" : null;
components/Paywall.tsx-284-
components/Paywall.tsx-285-      if (tier) {
components/Paywall.tsx-286-        const synced = await waitForWebhookProfileTier(tier);
components/Paywall.tsx-287-
components/Paywall.tsx-288-        if (synced) {
components/Paywall.tsx-289-          setToastMessage("You're in. Trial starts now.");
components/Paywall.tsx-290-          setToastVisible(true);
components/Paywall.tsx-291-          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/Paywall.tsx-292-          setTimeout(() => {
--
components/Paywall.tsx-356-    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
components/Paywall.tsx-357-    try {
components/Paywall.tsx-358-      const Purchases = (await import("react-native-purchases")).default;
components/Paywall.tsx:359:      const customerInfo = await Purchases.restorePurchases();
components/Paywall.tsx:360:      const tierHint = extractTierHintFromCustomerInfo(customerInfo);
components/Paywall.tsx-361-
components/Paywall.tsx-362-      if (!tierHint) {
components/Paywall.tsx-363-        showInlineError({
components/Paywall.tsx-364-          title: "No purchases found",
components/Paywall.tsx-365-          message: "We couldn't find purchases on this Apple ID. Contact support@lifemaintained.com if you think this is wrong.",
components/Paywall.tsx-366-        });
components/Paywall.tsx-367-        return;
components/Paywall.tsx-368-      }
components/Paywall.tsx-369-
components/Paywall.tsx-370-      const syncResult = await syncSubscriptionFromRc();
components/Paywall.tsx-371-      if (!syncResult.ok) {
components/Paywall.tsx-372-        showInlineError({
--
components/Paywall.tsx-382-
components/Paywall.tsx-383-      if (syncResult.tier === "free") {
components/Paywall.tsx-384-        showInlineError({
components/Paywall.tsx:385:          title: "No active subscription",
components/Paywall.tsx:386:          message: "We couldn't find an active subscription on this Apple ID. Contact support@lifemaintained.com if you think this is wrong.",
components/Paywall.tsx-387-        });
components/Paywall.tsx-388-        return;
components/Paywall.tsx-389-      }
components/Paywall.tsx-390-
components/Paywall.tsx-391-      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
components/Paywall.tsx-392-      setToastMessage("Purchases restored!");
components/Paywall.tsx-393-      setToastVisible(true);
components/Paywall.tsx-394-      setTimeout(() => { setToastVisible(false); onDismiss?.(); }, 1600);
components/Paywall.tsx-395-    } catch (e) {
components/Paywall.tsx-396-      console.error("[Paywall] Restore failed:", e);
components/Paywall.tsx-397-      showInlineError({
components/Paywall.tsx-398-        title: "Couldn't restore purchases",
--
components/Paywall.tsx-461-          <Ionicons name="phone-portrait-outline" size={48} color={Colors.accent} />
components/Paywall.tsx-462-          <Text style={styles.webFallbackTitle}>Subscribe on Mobile</Text>
components/Paywall.tsx-463-          <Text style={styles.webFallbackSub}>
components/Paywall.tsx:464:            Download LifeMaintained on iOS or Android to start your free trial.
components/Paywall.tsx-465-          </Text>
components/Paywall.tsx-466-        </View>
components/Paywall.tsx-467-      </View>
components/Paywall.tsx-468-    );
components/Paywall.tsx-469-  }
components/Paywall.tsx-470-
components/Paywall.tsx-471-  return (
components/Paywall.tsx-472-    <KeyboardAvoidingView
components/Paywall.tsx-473-      style={{ flex: 1, backgroundColor: Colors.background }}
components/Paywall.tsx-474-      behavior={Platform.OS === "ios" ? "padding" : undefined}
components/Paywall.tsx-475-      keyboardVerticalOffset={Platform.OS === "ios" ? topPad + 8 : 0}
components/Paywall.tsx-476-    >
--
components/Paywall.tsx-524-          keyboardShouldPersistTaps="handled"
components/Paywall.tsx-525-        >
components/Paywall.tsx-526-          {/* Billing toggle — segmented control */}
components/Paywall.tsx:527:          <View style={styles.billingToggle}>
components/Paywall.tsx-528-            {(["monthly", "annual"] as Billing[]).map(b => (
components/Paywall.tsx-529-              <Pressable
components/Paywall.tsx-530-                key={b}
components/Paywall.tsx:531:                style={[styles.billingOption, billing === b && styles.billingActive]}
components/Paywall.tsx-532-                onPress={() => { setBilling(b); Haptics.selectionAsync(); }}
components/Paywall.tsx-533-              >
components/Paywall.tsx:534:                <View style={styles.billingOptionContent}>
components/Paywall.tsx:535:                  <Text style={[styles.billingLabel, billing === b && styles.billingLabelActive]}>
components/Paywall.tsx-536-                    {b === "monthly" ? "Monthly" : "Annual"}
components/Paywall.tsx-537-                  </Text>
components/Paywall.tsx-538-                  {b === "annual" && (
components/Paywall.tsx:539:                    <Text style={[styles.saveText, billing === "annual" && styles.saveTextActive]}>
components/Paywall.tsx-540-                      {"  "}Save 40%
components/Paywall.tsx-541-                    </Text>
components/Paywall.tsx-542-                  )}
components/Paywall.tsx-543-                </View>
components/Paywall.tsx-544-              </Pressable>
components/Paywall.tsx-545-            ))}
components/Paywall.tsx-546-          </View>
components/Paywall.tsx-547-
components/Paywall.tsx-548-          {tiers.map(tier => {
components/Paywall.tsx-549-            const cfg = TIER_CONFIG[tier];
components/Paywall.tsx-550-            const selected = selectedTier === tier;
components/Paywall.tsx-551-            return (
--
components/Paywall.tsx-567-                        {cfg.label}
components/Paywall.tsx-568-                      </Text>
components/Paywall.tsx-569-                      <Text style={styles.tierPrice}>
components/Paywall.tsx:570:                        {billing === "annual" ? cfg.annualPrice : cfg.monthlyPrice}
components/Paywall.tsx-571-                      </Text>
components/Paywall.tsx:572:                      {billing === "annual" && (
components/Paywall.tsx-573-                        <Text style={styles.tierPriceSub}>{cfg.annualMonthly} · billed annually</Text>
components/Paywall.tsx-574-                      )}
components/Paywall.tsx-575-                    </View>
components/Paywall.tsx-576-                    <View style={[
components/Paywall.tsx-577-                      styles.radioOuter,
components/Paywall.tsx-578-                      selected && { borderColor: cfg.color },
components/Paywall.tsx-579-                    ]}>
components/Paywall.tsx-580-                      {selected && <View style={[styles.radioInner, { backgroundColor: cfg.color }]} />}
components/Paywall.tsx-581-                    </View>
components/Paywall.tsx-582-                  </View>
components/Paywall.tsx-583-                  <View style={styles.tierFeatures}>
components/Paywall.tsx-584-                    {cfg.features.map((f, i) => (
--
components/Paywall.tsx-601-            <Text style={styles.scanLimitsText}>Business: 100 AI scans/month</Text>
components/Paywall.tsx-602-          </View>
components/Paywall.tsx-603-
components/Paywall.tsx:604:          <Text style={styles.trialCalloutText}>
components/Paywall.tsx-605-            14 days free · Full access · Manage in Settings
components/Paywall.tsx-606-          </Text>
components/Paywall.tsx-607-
components/Paywall.tsx-608-          {inlineError && (
components/Paywall.tsx-609-            <View style={[
components/Paywall.tsx-610-              styles.inlineErrorCard,
components/Paywall.tsx-611-              inlineError.feedback === "warning" && styles.inlineWarningCard,
components/Paywall.tsx-612-            ]}>
components/Paywall.tsx-613-              <View style={styles.inlineErrorIcon}>
components/Paywall.tsx-614-                <Ionicons
components/Paywall.tsx-615-                  name={inlineError.feedback === "warning" ? "time-outline" : "alert-circle"}
components/Paywall.tsx-616-                  size={18}
--
components/Paywall.tsx-651-              <ActivityIndicator color={Colors.background} />
components/Paywall.tsx-652-            ) : (
components/Paywall.tsx-653-              <Text style={styles.ctaBtnText}>
components/Paywall.tsx:654:                {profile?.subscription_tier === "trial" && profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date()
components/Paywall.tsx-655-                  ? "Choose Plan"
components/Paywall.tsx-656-                  : "Start Free Trial"}
components/Paywall.tsx-657-              </Text>
components/Paywall.tsx-658-            )}
components/Paywall.tsx-659-          </Pressable>
components/Paywall.tsx-660-
components/Paywall.tsx-661-          <Text style={styles.legalText}>
components/Paywall.tsx:662:            Cancel anytime · Billed through App Store after trial
components/Paywall.tsx-663-          </Text>
components/Paywall.tsx-664-
components/Paywall.tsx-665-          {showSkip && (
components/Paywall.tsx-666-            <Pressable
components/Paywall.tsx-667-              style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
components/Paywall.tsx-668-              onPress={onSkip}
components/Paywall.tsx-669-              testID="paywall-skip"
components/Paywall.tsx-670-            >
components/Paywall.tsx-671-              <Text style={styles.skipText}>Maybe later</Text>
components/Paywall.tsx-672-            </Pressable>
components/Paywall.tsx-673-          )}
components/Paywall.tsx-674-
--
components/Paywall.tsx-764-  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
components/Paywall.tsx-765-
components/Paywall.tsx-766-  // Billing toggle — segmented control
components/Paywall.tsx:767:  billingToggle: {
components/Paywall.tsx-768-    flexDirection: "row",
components/Paywall.tsx-769-    borderRadius: 14,
components/Paywall.tsx-770-    borderWidth: 1,
components/Paywall.tsx-771-    borderColor: Colors.border,
components/Paywall.tsx-772-    overflow: "hidden",
components/Paywall.tsx-773-    backgroundColor: Colors.card,
components/Paywall.tsx-774-  },
components/Paywall.tsx:775:  billingOption: {
components/Paywall.tsx-776-    flex: 1,
components/Paywall.tsx-777-    alignItems: "center",
components/Paywall.tsx-778-    justifyContent: "center",
components/Paywall.tsx-779-    paddingVertical: 12,
components/Paywall.tsx-780-  },
components/Paywall.tsx:781:  billingActive: { backgroundColor: Colors.accent },
components/Paywall.tsx:782:  billingOptionContent: { flexDirection: "row", alignItems: "center" },
components/Paywall.tsx:783:  billingLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
components/Paywall.tsx:784:  billingLabelActive: { color: Colors.textInverse, fontFamily: "Inter_600SemiBold" },
components/Paywall.tsx-785-  saveText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.accent },
components/Paywall.tsx-786-  saveTextActive: { color: Colors.textInverse },
components/Paywall.tsx-787-
components/Paywall.tsx-788-  // Tier cards
components/Paywall.tsx-789-  tierWrapper: { gap: 4 },
components/Paywall.tsx-790-  popularLabel: {
components/Paywall.tsx-791-    fontSize: 11,
components/Paywall.tsx-792-    fontFamily: "Inter_600SemiBold",
components/Paywall.tsx-793-    paddingLeft: 2,
components/Paywall.tsx-794-  },
components/Paywall.tsx-795-  tierCard: {
components/Paywall.tsx-796-    backgroundColor: Colors.card,
--
components/Paywall.tsx-839-    color: Colors.textSecondary,
components/Paywall.tsx-840-  },
components/Paywall.tsx-841-
components/Paywall.tsx:842:  trialCalloutText: {
components/Paywall.tsx-843-    fontSize: 13,
components/Paywall.tsx-844-    fontFamily: "Inter_400Regular",
components/Paywall.tsx-845-    color: Colors.textSecondary,
components/Paywall.tsx-846-    textAlign: "center",
components/Paywall.tsx-847-  },
components/Paywall.tsx-848-  ctaBtn: {
components/Paywall.tsx-849-    backgroundColor: Colors.accent,
components/Paywall.tsx-850-    borderRadius: 14,
components/Paywall.tsx-851-    height: 52,
components/Paywall.tsx-852-    alignItems: "center",
components/Paywall.tsx-853-    justifyContent: "center",
components/Paywall.tsx-854-  },
--
components/ReceiptScanButton.tsx-54-        ? await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false })
components/ReceiptScanButton.tsx-55-        : await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ["images"] });
components/ReceiptScanButton.tsx-56-
components/ReceiptScanButton.tsx:57:      if (pickerResult.canceled || !pickerResult.assets?.[0]?.uri) {
components/ReceiptScanButton.tsx-58-        return;
components/ReceiptScanButton.tsx-59-      }
components/ReceiptScanButton.tsx-60-
components/ReceiptScanButton.tsx-61-      setScanning(true);
components/ReceiptScanButton.tsx-62-
components/ReceiptScanButton.tsx-63-      const manipulated = await ImageManipulator.manipulateAsync(
components/ReceiptScanButton.tsx-64-        pickerResult.assets[0].uri,
components/ReceiptScanButton.tsx-65-        [{ resize: { width: 2400 } }],
components/ReceiptScanButton.tsx-66-        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true }
components/ReceiptScanButton.tsx-67-      );
components/ReceiptScanButton.tsx-68-
components/ReceiptScanButton.tsx-69-      if (!manipulated.base64) {
--
components/ReceiptScanButton.tsx-105-    Alert.alert("Scan Receipt", "How would you like to add a receipt?", [
components/ReceiptScanButton.tsx-106-      { text: "Take Photo", onPress: () => handleScan(true) },
components/ReceiptScanButton.tsx-107-      { text: "Choose from Library", onPress: () => handleScan(false) },
components/ReceiptScanButton.tsx:108:      { text: "Cancel", style: "cancel" },
components/ReceiptScanButton.tsx-109-    ]);
components/ReceiptScanButton.tsx-110-  };
components/ReceiptScanButton.tsx-111-
components/ReceiptScanButton.tsx-112-  if (scanning) {
components/ReceiptScanButton.tsx-113-    return (
components/ReceiptScanButton.tsx-114-      <View style={styles.scanningContainer}>
components/ReceiptScanButton.tsx-115-        <ActivityIndicator size="small" color={Colors.accent} />
components/ReceiptScanButton.tsx-116-        <Text style={styles.scanningText}>Scanning receipt...</Text>
components/ReceiptScanButton.tsx-117-      </View>
components/ReceiptScanButton.tsx-118-    );
components/ReceiptScanButton.tsx-119-  }
components/ReceiptScanButton.tsx-120-
--
app/log-service/[vehicleId].tsx-23-import ReceiptScanButton from "@/components/ReceiptScanButton";
app/log-service/[vehicleId].tsx-24-import Paywall from "@/components/Paywall";
app/log-service/[vehicleId].tsx-25-import ScanPackModal from "@/components/ScanPackModal";
app/log-service/[vehicleId].tsx:26:import { isFreeTier } from "@/lib/subscription";
app/log-service/[vehicleId].tsx-27-import { ReceiptScanResult } from "@/lib/receiptScanner";
app/log-service/[vehicleId].tsx-28-import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
app/log-service/[vehicleId].tsx-29-import DatePicker from "@/components/DatePicker";
app/log-service/[vehicleId].tsx-30-import { parseISO, format } from "date-fns";
app/log-service/[vehicleId].tsx-31-import { SaveToast } from "@/components/SaveToast";
app/log-service/[vehicleId].tsx-32-import { matchAndUpdateVehicleTask, CATEGORY_GROUPS, type MatchResult } from "@/lib/maintenanceMatcher";
app/log-service/[vehicleId].tsx-33-import { resolveTrackingMode, isHoursTracked, isMileageTracked } from "@/lib/usageHelpers";
app/log-service/[vehicleId].tsx-34-import { updateVehicleUsage } from "@/lib/vehicleUsageHelper";
app/log-service/[vehicleId].tsx-35-import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
app/log-service/[vehicleId].tsx-36-
app/log-service/[vehicleId].tsx-37-type PricingInsight = {
app/log-service/[vehicleId].tsx-38-  cost: number | null;
--
app/_layout.tsx-49-const VOICE_LOG_URL = "lifemaintained://voice-log";
app/_layout.tsx-50-
app/_layout.tsx-51-focusManager.setEventListener((handleFocus) => {
app/_layout.tsx:52:  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
app/_layout.tsx-53-    handleFocus(state === "active");
app/_layout.tsx-54-  });
app/_layout.tsx:55:  return () => subscription.remove();
app/_layout.tsx-56-});
app/_layout.tsx-57-
app/_layout.tsx-58-function RootLayoutNav() {
app/_layout.tsx-59-  const { session, isLoading, onboardingCompleted, refreshProfile } = useAuth();
app/_layout.tsx-60-  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
app/_layout.tsx-61-
app/_layout.tsx-62-  useEffect(() => {
app/_layout.tsx-63-    if (!isLoading) {
app/_layout.tsx-64-      SplashScreen.hideAsync();
app/_layout.tsx-65-    }
app/_layout.tsx-66-  }, [isLoading]);
app/_layout.tsx-67-
--
app/_layout.tsx-104-    })();
app/_layout.tsx-105-  }, [session?.user?.id]);
app/_layout.tsx-106-
app/_layout.tsx:107:  // RC customerInfoUpdate listener — keeps the client in sync with background
app/_layout.tsx:108:  // renewals, expirations, and billing-issue resolutions even when the
app/_layout.tsx-109-  // server-side webhook is delayed or hasn't fired yet. Throttled at 5s
app/_layout.tsx:110:  // because RevenueCat can emit multiple customerInfo updates in quick
app/_layout.tsx-111-  // succession; the Paywall flow handles its own post-purchase sync directly.
app/_layout.tsx-112-  useEffect(() => {
app/_layout.tsx-113-    if (!session?.user?.id || Platform.OS === "web") return;
app/_layout.tsx-114-
app/_layout.tsx:115:    let cancelled = false;
app/_layout.tsx-116-    let cleanup: (() => void) | null = null;
app/_layout.tsx-117-    let lastSyncAt = 0;
app/_layout.tsx-118-
app/_layout.tsx-119-    (async () => {
app/_layout.tsx-120-      try {
app/_layout.tsx-121-        await rcReady;
app/_layout.tsx:122:        if (cancelled) return;
app/_layout.tsx-123-        const Purchases = (await import("react-native-purchases")).default;
app/_layout.tsx-124-        const { syncSubscriptionFromRc } = await import("@/lib/revenuecat");
app/_layout.tsx-125-
app/_layout.tsx-126-        const handler = async () => {
app/_layout.tsx-127-          const now = Date.now();
app/_layout.tsx-128-          if (now - lastSyncAt < 5000) return;
app/_layout.tsx-129-          lastSyncAt = now;
app/_layout.tsx-130-
app/_layout.tsx-131-          try {
app/_layout.tsx-132-            const result = await syncSubscriptionFromRc();
app/_layout.tsx-133-            if (result.ok) {
app/_layout.tsx-134-              await refreshProfile();
app/_layout.tsx-135-            }
app/_layout.tsx-136-          } catch (e) {
app/_layout.tsx:137:            console.error("[RevenueCat] customerInfoUpdate handler failed:", e);
app/_layout.tsx-138-          }
app/_layout.tsx-139-        };
app/_layout.tsx-140-
app/_layout.tsx-141-        Purchases.addCustomerInfoUpdateListener(handler);
app/_layout.tsx-142-        cleanup = () => {
app/_layout.tsx-143-          try {
app/_layout.tsx-144-            Purchases.removeCustomerInfoUpdateListener(handler);
app/_layout.tsx-145-          } catch (e) {
app/_layout.tsx-146-            console.warn("[RevenueCat] listener cleanup failed:", e);
app/_layout.tsx-147-          }
app/_layout.tsx-148-        };
app/_layout.tsx-149-      } catch (e) {
--
app/_layout.tsx-152-    })();
app/_layout.tsx-153-
app/_layout.tsx-154-    return () => {
app/_layout.tsx:155:      cancelled = true;
app/_layout.tsx-156-      if (cleanup) cleanup();
app/_layout.tsx-157-    };
app/_layout.tsx-158-  }, [session?.user?.id, refreshProfile]);
app/_layout.tsx-159-
app/_layout.tsx-160-  // Deep link: lifemaintained://reset-password → password reset (no session gate)
app/_layout.tsx-161-  useEffect(() => {
app/_layout.tsx-162-    const handleResetUrl = (url: string | null) => {
app/_layout.tsx-163-      if (!url) return;
app/_layout.tsx-164-      try {
app/_layout.tsx-165-        const parsed = Linking.parse(url);
app/_layout.tsx-166-        if (parsed.scheme === "lifemaintained" && parsed.path === "reset-password") {
app/_layout.tsx-167-          const { router } = require("expo-router");
--
app/_layout.tsx-220-          <Stack.Screen name="add-family-member" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-221-          <Stack.Screen name="health-profile" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-222-          <Stack.Screen name="update-mileage/[vehicleId]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx:223:          <Stack.Screen name="subscription" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-224-          <Stack.Screen name="notifications-settings" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-225-          <Stack.Screen name="terms-of-service" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-226-          <Stack.Screen name="privacy-policy" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-227-          <Stack.Screen name="reset-password" options={{ headerShown: false, presentation: "fullScreenModal" }} />
app/_layout.tsx-228-        </Stack>
app/_layout.tsx-229-        {showBanner && <NotifPermissionBanner userId={session?.user?.id} />}
app/_layout.tsx-230-      </View>
app/_layout.tsx-231-    </BudgetAlertProvider>
app/_layout.tsx-232-  );
app/_layout.tsx-233-}
app/_layout.tsx-234-
app/_layout.tsx-235-function RootLayout() {
--
lib/supabase-types.ts-751-          revenuecat_customer_id: string | null
lib/supabase-types.ts-752-          scan_count_reset_at: string | null
lib/supabase-types.ts-753-          stripe_customer_id: string | null
lib/supabase-types.ts:754:          stripe_subscription_id: string | null
lib/supabase-types.ts:755:          subscription_expires_at: string | null
lib/supabase-types.ts:756:          subscription_renewal_date: string | null
lib/supabase-types.ts:757:          subscription_start_date: string | null
lib/supabase-types.ts:758:          subscription_tier: string
lib/supabase-types.ts:759:          trial_end_date: string | null
lib/supabase-types.ts:760:          trial_expires_at: string | null
lib/supabase-types.ts:761:          trial_start_date: string | null
lib/supabase-types.ts:762:          trial_started_at: string | null
lib/supabase-types.ts-763-          updated_at: string
lib/supabase-types.ts-764-          user_id: string
lib/supabase-types.ts-765-          zip_code: string | null
lib/supabase-types.ts-766-        }
lib/supabase-types.ts-767-        Insert: {
lib/supabase-types.ts-768-          beta_premium_until?: string | null
lib/supabase-types.ts-769-          budget_notifications_enabled?: boolean | null
lib/supabase-types.ts-770-          created_at?: string
lib/supabase-types.ts-771-          email?: string | null
lib/supabase-types.ts-772-          id?: string
lib/supabase-types.ts-773-          is_beta_user?: boolean | null
lib/supabase-types.ts-774-          monthly_scan_count?: number
--
lib/supabase-types.ts-780-          revenuecat_customer_id?: string | null
lib/supabase-types.ts-781-          scan_count_reset_at?: string | null
lib/supabase-types.ts-782-          stripe_customer_id?: string | null
lib/supabase-types.ts:783:          stripe_subscription_id?: string | null
lib/supabase-types.ts:784:          subscription_expires_at?: string | null
lib/supabase-types.ts:785:          subscription_renewal_date?: string | null
lib/supabase-types.ts:786:          subscription_start_date?: string | null
lib/supabase-types.ts:787:          subscription_tier?: string
lib/supabase-types.ts:788:          trial_end_date?: string | null
lib/supabase-types.ts:789:          trial_expires_at?: string | null
lib/supabase-types.ts:790:          trial_start_date?: string | null
lib/supabase-types.ts:791:          trial_started_at?: string | null
lib/supabase-types.ts-792-          updated_at?: string
lib/supabase-types.ts-793-          user_id: string
lib/supabase-types.ts-794-          zip_code?: string | null
lib/supabase-types.ts-795-        }
lib/supabase-types.ts-796-        Update: {
lib/supabase-types.ts-797-          beta_premium_until?: string | null
lib/supabase-types.ts-798-          budget_notifications_enabled?: boolean | null
lib/supabase-types.ts-799-          created_at?: string
lib/supabase-types.ts-800-          email?: string | null
lib/supabase-types.ts-801-          id?: string
lib/supabase-types.ts-802-          is_beta_user?: boolean | null
lib/supabase-types.ts-803-          monthly_scan_count?: number
--
lib/supabase-types.ts-809-          revenuecat_customer_id?: string | null
lib/supabase-types.ts-810-          scan_count_reset_at?: string | null
lib/supabase-types.ts-811-          stripe_customer_id?: string | null
lib/supabase-types.ts:812:          stripe_subscription_id?: string | null
lib/supabase-types.ts:813:          subscription_expires_at?: string | null
lib/supabase-types.ts:814:          subscription_renewal_date?: string | null
lib/supabase-types.ts:815:          subscription_start_date?: string | null
lib/supabase-types.ts:816:          subscription_tier?: string
lib/supabase-types.ts:817:          trial_end_date?: string | null
lib/supabase-types.ts:818:          trial_expires_at?: string | null
lib/supabase-types.ts:819:          trial_start_date?: string | null
lib/supabase-types.ts:820:          trial_started_at?: string | null
lib/supabase-types.ts-821-          updated_at?: string
lib/supabase-types.ts-822-          user_id?: string
lib/supabase-types.ts-823-          zip_code?: string | null
lib/supabase-types.ts-824-        }
lib/supabase-types.ts-825-        Relationships: []
lib/supabase-types.ts-826-      }
lib/supabase-types.ts-827-      promo_codes: {
lib/supabase-types.ts-828-        Row: {
lib/supabase-types.ts-829-          code: string
lib/supabase-types.ts-830-          created_at: string | null
lib/supabase-types.ts-831-          current_uses: number
lib/supabase-types.ts-832-          description: string | null
lib/supabase-types.ts-833-          duration_days: number
lib/supabase-types.ts:834:          expires_at: string | null
lib/supabase-types.ts-835-          id: string
lib/supabase-types.ts-836-          max_uses: number | null
lib/supabase-types.ts-837-          tier: string
lib/supabase-types.ts-838-        }
lib/supabase-types.ts-839-        Insert: {
lib/supabase-types.ts-840-          code: string
lib/supabase-types.ts-841-          created_at?: string | null
lib/supabase-types.ts-842-          current_uses?: number
lib/supabase-types.ts-843-          description?: string | null
lib/supabase-types.ts-844-          duration_days?: number
lib/supabase-types.ts:845:          expires_at?: string | null
lib/supabase-types.ts-846-          id?: string
lib/supabase-types.ts-847-          max_uses?: number | null
lib/supabase-types.ts-848-          tier?: string
lib/supabase-types.ts-849-        }
lib/supabase-types.ts-850-        Update: {
lib/supabase-types.ts-851-          code?: string
lib/supabase-types.ts-852-          created_at?: string | null
lib/supabase-types.ts-853-          current_uses?: number
lib/supabase-types.ts-854-          description?: string | null
lib/supabase-types.ts-855-          duration_days?: number
lib/supabase-types.ts:856:          expires_at?: string | null
lib/supabase-types.ts-857-          id?: string
lib/supabase-types.ts-858-          max_uses?: number | null
lib/supabase-types.ts-859-          tier?: string
lib/supabase-types.ts-860-        }
lib/supabase-types.ts-861-        Relationships: []
lib/supabase-types.ts-862-      }
lib/supabase-types.ts-863-      promo_redemptions: {
lib/supabase-types.ts-864-        Row: {
lib/supabase-types.ts-865-          id: string
lib/supabase-types.ts-866-          promo_code_id: string
lib/supabase-types.ts-867-          redeemed_at: string
lib/supabase-types.ts-868-          user_id: string
--
lib/supabase-types.ts-1038-          created_at: string
lib/supabase-types.ts-1039-          duplicate_hash: string | null
lib/supabase-types.ts-1040-          error_message: string | null
lib/supabase-types.ts:1041:          expires_at: string
lib/supabase-types.ts-1042-          field_confidence: Json | null
lib/supabase-types.ts-1043-          id: string
lib/supabase-types.ts-1044-          image_path: string | null
lib/supabase-types.ts-1045-          normalized_output: Json | null
lib/supabase-types.ts-1046-          raw_ocr_response: Json | null
lib/supabase-types.ts-1047-          request_id: string
lib/supabase-types.ts-1048-          source: string
lib/supabase-types.ts-1049-          status: string
lib/supabase-types.ts-1050-          updated_at: string
lib/supabase-types.ts-1051-          user_confirmed_output: Json | null
lib/supabase-types.ts-1052-          user_id: string
lib/supabase-types.ts-1053-        }
--
lib/supabase-types.ts-1059-          created_at?: string
lib/supabase-types.ts-1060-          duplicate_hash?: string | null
lib/supabase-types.ts-1061-          error_message?: string | null
lib/supabase-types.ts:1062:          expires_at?: string
lib/supabase-types.ts-1063-          field_confidence?: Json | null
lib/supabase-types.ts-1064-          id?: string
lib/supabase-types.ts-1065-          image_path?: string | null
lib/supabase-types.ts-1066-          normalized_output?: Json | null
lib/supabase-types.ts-1067-          raw_ocr_response?: Json | null
lib/supabase-types.ts-1068-          request_id: string
lib/supabase-types.ts-1069-          source?: string
lib/supabase-types.ts-1070-          status?: string
lib/supabase-types.ts-1071-          updated_at?: string
lib/supabase-types.ts-1072-          user_confirmed_output?: Json | null
lib/supabase-types.ts-1073-          user_id: string
lib/supabase-types.ts-1074-        }
--
lib/supabase-types.ts-1080-          created_at?: string
lib/supabase-types.ts-1081-          duplicate_hash?: string | null
lib/supabase-types.ts-1082-          error_message?: string | null
lib/supabase-types.ts:1083:          expires_at?: string
lib/supabase-types.ts-1084-          field_confidence?: Json | null
lib/supabase-types.ts-1085-          id?: string
lib/supabase-types.ts-1086-          image_path?: string | null
lib/supabase-types.ts-1087-          normalized_output?: Json | null
lib/supabase-types.ts-1088-          raw_ocr_response?: Json | null
lib/supabase-types.ts-1089-          request_id?: string
lib/supabase-types.ts-1090-          source?: string
lib/supabase-types.ts-1091-          status?: string
lib/supabase-types.ts-1092-          updated_at?: string
lib/supabase-types.ts-1093-          user_confirmed_output?: Json | null
lib/supabase-types.ts-1094-          user_id?: string
lib/supabase-types.ts-1095-        }
--
lib/supabase-types.ts-1330-        }
lib/supabase-types.ts-1331-        Relationships: []
lib/supabase-types.ts-1332-      }
lib/supabase-types.ts:1333:      subscription_history: {
lib/supabase-types.ts-1334-        Row: {
lib/supabase-types.ts-1335-          created_at: string
lib/supabase-types.ts-1336-          event_type: string
lib/supabase-types.ts-1337-          from_tier: string | null
lib/supabase-types.ts-1338-          id: string
lib/supabase-types.ts-1339-          promo_code_id: string | null
lib/supabase-types.ts-1340-          to_tier: string | null
lib/supabase-types.ts-1341-          user_id: string
lib/supabase-types.ts-1342-        }
lib/supabase-types.ts-1343-        Insert: {
lib/supabase-types.ts-1344-          created_at?: string
lib/supabase-types.ts-1345-          event_type: string
--
lib/supabase-types.ts-2056-        | "quoted"
lib/supabase-types.ts-2057-        | "booked"
lib/supabase-types.ts-2058-        | "completed"
lib/supabase-types.ts:2059:        | "cancelled"
lib/supabase-types.ts-2060-      notification_priority: "low" | "medium" | "high" | "critical"
lib/supabase-types.ts-2061-      notification_type:
lib/supabase-types.ts-2062-        | "maintenance_due"
lib/supabase-types.ts-2063-        | "maintenance_overdue"
lib/supabase-types.ts-2064-        | "budget_alert"
lib/supabase-types.ts-2065-        | "seasonal_reminder"
lib/supabase-types.ts-2066-        | "milestone"
lib/supabase-types.ts:2067:        | "trial_ending"
lib/supabase-types.ts-2068-        | "welcome"
lib/supabase-types.ts-2069-        | "inactive_reminder"
lib/supabase-types.ts-2070-        | "completion"
lib/supabase-types.ts-2071-      service_type:
lib/supabase-types.ts-2072-        | "auto_mechanic"
lib/supabase-types.ts-2073-        | "dentist"
lib/supabase-types.ts-2074-        | "hvac_technician"
lib/supabase-types.ts-2075-        | "plumber"
lib/supabase-types.ts-2076-        | "electrician"
lib/supabase-types.ts-2077-        | "roofer"
lib/supabase-types.ts-2078-        | "veterinarian"
lib/supabase-types.ts-2079-        | "general_contractor"
--
lib/supabase-types.ts-2219-        "quoted",
lib/supabase-types.ts-2220-        "booked",
lib/supabase-types.ts-2221-        "completed",
lib/supabase-types.ts:2222:        "cancelled",
lib/supabase-types.ts-2223-      ],
lib/supabase-types.ts-2224-      notification_priority: ["low", "medium", "high", "critical"],
lib/supabase-types.ts-2225-      notification_type: [
lib/supabase-types.ts-2226-        "maintenance_due",
lib/supabase-types.ts-2227-        "maintenance_overdue",
lib/supabase-types.ts-2228-        "budget_alert",
lib/supabase-types.ts-2229-        "seasonal_reminder",
lib/supabase-types.ts-2230-        "milestone",
lib/supabase-types.ts:2231:        "trial_ending",
lib/supabase-types.ts-2232-        "welcome",
lib/supabase-types.ts-2233-        "inactive_reminder",
lib/supabase-types.ts-2234-        "completion",
lib/supabase-types.ts-2235-      ],
lib/supabase-types.ts-2236-      service_type: [
lib/supabase-types.ts-2237-        "auto_mechanic",
lib/supabase-types.ts-2238-        "dentist",
lib/supabase-types.ts-2239-        "hvac_technician",
lib/supabase-types.ts-2240-        "plumber",
lib/supabase-types.ts-2241-        "electrician",
lib/supabase-types.ts-2242-        "roofer",
lib/supabase-types.ts-2243-        "veterinarian",
--
lib/revenuecat.ts-5-export type RcTier = "personal" | "pro" | "business" | null;
lib/revenuecat.ts-6-
lib/revenuecat.ts-7-export function extractTierHintFromCustomerInfo(
lib/revenuecat.ts:8:  customerInfo: { entitlements?: { active?: Record<string, unknown> } } | null | undefined
lib/revenuecat.ts-9-): RcTier {
lib/revenuecat.ts:10:  const active = customerInfo?.entitlements?.active ?? {};
lib/revenuecat.ts-11-  if ("business_access" in active) return "business";
lib/revenuecat.ts-12-  if ("pro_access" in active) return "pro";
lib/revenuecat.ts-13-  if ("personal_access" in active) return "personal";
lib/revenuecat.ts-14-  return null;
lib/revenuecat.ts-15-}
lib/revenuecat.ts-16-
lib/revenuecat.ts:17:export type SyncSuccessAction = "synced" | "downgraded" | "skipped_trial";
lib/revenuecat.ts-18-export type SyncSuccessTier = "personal" | "pro" | "business" | "free" | null;
lib/revenuecat.ts-19-
lib/revenuecat.ts-20-export type SyncResult =
lib/revenuecat.ts:21:  | { ok: true; tier: SyncSuccessTier; expiresAt: string | null; action: SyncSuccessAction }
lib/revenuecat.ts-22-  | { ok: false; error: string };
lib/revenuecat.ts-23-
lib/revenuecat.ts-24-function isSyncSuccessTier(value: unknown): value is SyncSuccessTier {
lib/revenuecat.ts-25-  return value === "personal" || value === "pro" || value === "business" || value === "free" || value === null;
lib/revenuecat.ts-26-}
lib/revenuecat.ts-27-
lib/revenuecat.ts-28-function isSyncSuccessAction(value: unknown): value is SyncSuccessAction {
lib/revenuecat.ts:29:  return value === "synced" || value === "downgraded" || value === "skipped_trial";
lib/revenuecat.ts-30-}
lib/revenuecat.ts-31-
lib/revenuecat.ts-32-function isRecord(value: unknown): value is Record<string, unknown> {
lib/revenuecat.ts-33-  return typeof value === "object" && value !== null;
lib/revenuecat.ts-34-}
lib/revenuecat.ts-35-
lib/revenuecat.ts-36-function parseSyncResponse(data: unknown): SyncResult {
lib/revenuecat.ts-37-  if (!isRecord(data)) {
lib/revenuecat.ts-38-    return { ok: false, error: "Invalid response" };
lib/revenuecat.ts-39-  }
lib/revenuecat.ts-40-
lib/revenuecat.ts-41-  const tier = data.tier;
lib/revenuecat.ts:42:  const expiresAt = data.expiresAt;
lib/revenuecat.ts-43-  const action = data.action;
lib/revenuecat.ts-44-
lib/revenuecat.ts-45-  if (!isSyncSuccessTier(tier)) return { ok: false, error: "Invalid response" };
lib/revenuecat.ts:46:  if (!(typeof expiresAt === "string" || expiresAt === null)) return { ok: false, error: "Invalid response" };
lib/revenuecat.ts-47-  if (!isSyncSuccessAction(action)) return { ok: false, error: "Invalid response" };
lib/revenuecat.ts-48-
lib/revenuecat.ts:49:  return { ok: true, tier, expiresAt, action };
lib/revenuecat.ts-50-}
lib/revenuecat.ts-51-
lib/revenuecat.ts-52-export async function syncSubscriptionFromRc(): Promise<SyncResult> {
lib/revenuecat.ts-53-  const { supabase } = await import("./supabase");
lib/revenuecat.ts:54:  const { data, error } = await supabase.functions.invoke("sync-subscription-from-rc", {
lib/revenuecat.ts-55-    method: "POST",
lib/revenuecat.ts-56-  });
lib/revenuecat.ts-57-
lib/revenuecat.ts-58-  if (error) {
lib/revenuecat.ts-59-    console.error("[revenuecat] sync failed:", error);
lib/revenuecat.ts-60-    return { ok: false, error: error.message ?? "Sync failed" };
lib/revenuecat.ts-61-  }
lib/revenuecat.ts-62-
lib/revenuecat.ts-63-  return parseSyncResponse(data);
lib/revenuecat.ts-64-}
--
lib/subscription.ts-3-
lib/subscription.ts-4-export type Profile = {
lib/subscription.ts-5-  user_id?: string;
lib/subscription.ts:6:  subscription_tier: string | null;
lib/subscription.ts:7:  trial_started_at: string | null;
lib/subscription.ts:8:  trial_expires_at: string | null;
lib/subscription.ts:9:  subscription_expires_at: string | null;
lib/subscription.ts-10-  revenuecat_customer_id: string | null;
lib/subscription.ts-11-  push_token: string | null;
lib/subscription.ts-12-  monthly_scan_count: number;
lib/subscription.ts-13-  scan_count_reset_at: string | null;
lib/subscription.ts-14-  onboarding_completed: boolean | null;
lib/subscription.ts-15-};
lib/subscription.ts-16-
lib/subscription.ts-17-const PAID_TIERS = ["personal", "pro", "business"];
lib/subscription.ts-18-
lib/subscription.ts-19-export function hasActivePremium(profile: Profile | null | undefined): boolean {
lib/subscription.ts-20-  if (!profile) return false;
lib/subscription.ts-21-  try {
lib/subscription.ts-22-    if (
lib/subscription.ts:23:      profile.subscription_tier === "trial" &&
lib/subscription.ts:24:      profile.trial_expires_at &&
lib/subscription.ts:25:      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts-26-    ) return true;
lib/subscription.ts-27-
lib/subscription.ts-28-    if (
lib/subscription.ts:29:      PAID_TIERS.includes(profile.subscription_tier ?? "") &&
lib/subscription.ts:30:      profile.subscription_expires_at &&
lib/subscription.ts:31:      new Date(profile.subscription_expires_at) > new Date()
lib/subscription.ts-32-    ) return true;
lib/subscription.ts-33-
lib/subscription.ts-34-    return false;
lib/subscription.ts-35-  } catch {
lib/subscription.ts-36-    return false;
lib/subscription.ts-37-  }
lib/subscription.ts-38-}
lib/subscription.ts-39-
lib/subscription.ts-40-export function hasPersonalOrAbove(profile: Profile | null | undefined): boolean {
lib/subscription.ts-41-  return hasActivePremium(profile);
lib/subscription.ts-42-}
lib/subscription.ts-43-
--
lib/subscription.ts-45-  if (!profile) return false;
lib/subscription.ts-46-  try {
lib/subscription.ts-47-    if (
lib/subscription.ts:48:      profile.subscription_tier === "trial" &&
lib/subscription.ts:49:      profile.trial_expires_at &&
lib/subscription.ts:50:      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts-51-    ) return true;
lib/subscription.ts-52-    if (
lib/subscription.ts:53:      ["pro", "business"].includes(profile.subscription_tier ?? "") &&
lib/subscription.ts:54:      profile.subscription_expires_at &&
lib/subscription.ts:55:      new Date(profile.subscription_expires_at) > new Date()
lib/subscription.ts-56-    ) return true;
lib/subscription.ts-57-    return false;
lib/subscription.ts-58-  } catch {
lib/subscription.ts-59-    return false;
lib/subscription.ts-60-  }
lib/subscription.ts-61-}
lib/subscription.ts-62-
lib/subscription.ts-63-export function hasBusiness(profile: Profile | null | undefined): boolean {
lib/subscription.ts-64-  if (!profile) return false;
lib/subscription.ts-65-  try {
lib/subscription.ts-66-    return (
lib/subscription.ts:67:      profile.subscription_tier === "business" &&
lib/subscription.ts:68:      !!profile.subscription_expires_at &&
lib/subscription.ts:69:      new Date(profile.subscription_expires_at) > new Date()
lib/subscription.ts-70-    );
lib/subscription.ts-71-  } catch {
lib/subscription.ts-72-    return false;
lib/subscription.ts-73-  }
lib/subscription.ts-74-}
lib/subscription.ts-75-
lib/subscription.ts-76-export function vehicleLimit(profile: Profile | null | undefined): number {
lib/subscription.ts-77-  if (hasBusiness(profile)) return Infinity;
lib/subscription.ts-78-  if (hasProOrAbove(profile)) return 6;
lib/subscription.ts-79-  if (hasPersonalOrAbove(profile)) return 3;
lib/subscription.ts-80-  return 1;
lib/subscription.ts-81-}
--
lib/subscription.ts-112-  if (!profile) return false;
lib/subscription.ts-113-  try {
lib/subscription.ts-114-    return (
lib/subscription.ts:115:      profile.subscription_tier === "trial" &&
lib/subscription.ts:116:      !!profile.trial_expires_at &&
lib/subscription.ts:117:      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts-118-    );
lib/subscription.ts-119-  } catch {
lib/subscription.ts-120-    return false;
lib/subscription.ts-121-  }
lib/subscription.ts-122-}
lib/subscription.ts-123-
lib/subscription.ts-124-export function isFreeTier(profile: Profile | null | undefined): boolean {
lib/subscription.ts-125-  return !hasActivePremium(profile);
lib/subscription.ts-126-}
lib/subscription.ts-127-
lib/subscription.ts-128-/**
lib/subscription.ts-129- * Legacy UI helper only.
--
lib/subscription.ts-133-  return Math.max(0, scanLimit(profile) - ((profile?.monthly_scan_count) ?? 0));
lib/subscription.ts-134-}
lib/subscription.ts-135-
lib/subscription.ts:136:export function trialDaysRemaining(profile: Profile | null | undefined): number {
lib/subscription.ts:137:  if (!profile || !isInTrial(profile) || !profile.trial_expires_at) return 0;
lib/subscription.ts-138-  try {
lib/subscription.ts:139:    const ms = new Date(profile.trial_expires_at).getTime() - Date.now();
lib/subscription.ts-140-    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
lib/subscription.ts-141-  } catch {
lib/subscription.ts-142-    return 0;
lib/subscription.ts-143-  }
lib/subscription.ts-144-}
lib/subscription.ts-145-
lib/subscription.ts-146-/**
lib/subscription.ts-147- * Legacy no-op. Receipt scan quota is now enforced by receipt_scans rows.
lib/subscription.ts-148- */
lib/subscription.ts-149-export async function incrementScanCount(_userId: string): Promise<void> {
lib/subscription.ts-150-  return;
lib/subscription.ts-151-}
--
app/add-family-member.tsx-1-import React, { useState } from "react";
app/add-family-member.tsx-2-import { SaveToast } from "@/components/SaveToast";
app/add-family-member.tsx-3-import Paywall from "@/components/Paywall";
app/add-family-member.tsx:4:import { personLimit, petLimit } from "@/lib/subscription";
app/add-family-member.tsx-5-import {
app/add-family-member.tsx-6-  View,
app/add-family-member.tsx-7-  Text,
app/add-family-member.tsx-8-  TextInput,
app/add-family-member.tsx-9-  Pressable,
app/add-family-member.tsx-10-  StyleSheet,
app/add-family-member.tsx-11-  ScrollView,
app/add-family-member.tsx-12-  Platform,
app/add-family-member.tsx-13-  ActivityIndicator,
app/add-family-member.tsx-14-  Modal,
app/add-family-member.tsx-15-} from "react-native";
app/add-family-member.tsx-16-import { KeyboardAvoidingView } from "react-native-keyboard-controller";
--
app/property/[id].tsx-337-        { text: "Take Photo", onPress: () => pickPropertyPhoto("camera") },
app/property/[id].tsx-338-        { text: "Choose from Library", onPress: () => pickPropertyPhoto("library") },
app/property/[id].tsx-339-        { text: "Remove Photo", style: "destructive", onPress: removePropertyPhoto },
app/property/[id].tsx:340:        { text: "Cancel", style: "cancel" },
app/property/[id].tsx-341-      ]);
app/property/[id].tsx-342-    } else {
app/property/[id].tsx-343-      Alert.alert("Add Photo", "Choose an option", [
app/property/[id].tsx-344-        { text: "Take Photo", onPress: () => pickPropertyPhoto("camera") },
app/property/[id].tsx-345-        { text: "Choose from Library", onPress: () => pickPropertyPhoto("library") },
app/property/[id].tsx:346:        { text: "Cancel", style: "cancel" },
app/property/[id].tsx-347-      ]);
app/property/[id].tsx-348-    }
app/property/[id].tsx-349-  }
app/property/[id].tsx-350-
app/property/[id].tsx-351-  async function pickPropertyPhoto(source: "camera" | "library") {
app/property/[id].tsx-352-    try {
app/property/[id].tsx-353-      const result = source === "camera"
app/property/[id].tsx-354-        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] })
app/property/[id].tsx-355-        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
app/property/[id].tsx:356:      if (result.canceled) return;
app/property/[id].tsx-357-      const uri = result.assets[0].uri;
app/property/[id].tsx-358-      setUploadingPhoto(true);
app/property/[id].tsx-359-      try {
app/property/[id].tsx-360-        const response = await fetch(uri);
app/property/[id].tsx-361-        const blob = await response.blob();
app/property/[id].tsx-362-        const arrayBuffer = await blob.arrayBuffer();
app/property/[id].tsx-363-        const storagePath = `${user!.id}/${id}.jpg`;
app/property/[id].tsx-364-        const { error: uploadError } = await supabase.storage
app/property/[id].tsx-365-          .from("property-photos")
app/property/[id].tsx-366-          .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/property/[id].tsx-367-        if (uploadError) throw uploadError;
app/property/[id].tsx-368-        const { data: urlData } = supabase.storage.from("property-photos").getPublicUrl(storagePath);
--
app/property/[id].tsx-399-      "Delete Property",
app/property/[id].tsx-400-      "This will permanently delete this property and all its tasks. This cannot be undone.",
app/property/[id].tsx-401-      [
app/property/[id].tsx:402:        { text: "Cancel", style: "cancel" },
app/property/[id].tsx-403-        {
app/property/[id].tsx-404-          text: "Delete",
app/property/[id].tsx-405-          style: "destructive",
app/property/[id].tsx-406-          onPress: () => {
app/property/[id].tsx-407-            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
app/property/[id].tsx-408-
app/property/[id].tsx-409-            for (const key of [["properties"], ["properties", userId]] as const) {
app/property/[id].tsx-410-              queryClient.setQueryData(key, (old: any) => {
app/property/[id].tsx-411-                if (!old) return old;
app/property/[id].tsx-412-                if (Array.isArray(old)) return old.filter((v: any) => v.id !== id);
app/property/[id].tsx-413-                if (old.data && Array.isArray(old.data)) {
app/property/[id].tsx-414-                  return { ...old, data: old.data.filter((v: any) => v.id !== id) };
--
app/property-task-history/[propertyId].tsx-53-      "Delete Record",
app/property-task-history/[propertyId].tsx-54-      "This service record will be permanently deleted.",
app/property-task-history/[propertyId].tsx-55-      [
app/property-task-history/[propertyId].tsx:56:        { text: "Cancel", style: "cancel" },
app/property-task-history/[propertyId].tsx-57-        {
app/property-task-history/[propertyId].tsx-58-          text: "Delete",
app/property-task-history/[propertyId].tsx-59-          style: "destructive",
app/property-task-history/[propertyId].tsx-60-          onPress: async () => {
app/property-task-history/[propertyId].tsx-61-            try {
app/property-task-history/[propertyId].tsx-62-              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
app/property-task-history/[propertyId].tsx-63-              await supabase.from("maintenance_logs").delete().eq("id", logId);
app/property-task-history/[propertyId].tsx-64-              queryClient.invalidateQueries({ queryKey: ["property_task_logs", propertyId, task] });
app/property-task-history/[propertyId].tsx-65-              queryClient.invalidateQueries({ queryKey: ["property_logs", propertyId] });
app/property-task-history/[propertyId].tsx-66-            } catch (err: any) {
app/property-task-history/[propertyId].tsx-67-              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
app/property-task-history/[propertyId].tsx-68-            }
--
app/privacy-policy.tsx-12-  },
app/privacy-policy.tsx-13-  {
app/privacy-policy.tsx-14-    title: "2. How We Use Information",
app/privacy-policy.tsx:15:    body: "We use your data to provide maintenance tracking and reminders, generate schedules, insights, and estimates, process receipts, images, and voice input, operate subscriptions and billing, improve product performance and reliability, and provide customer support. We do not sell your personal data.",
app/privacy-policy.tsx-16-  },
app/privacy-policy.tsx-17-  {
app/privacy-policy.tsx-18-    title: "3. AI Processing",
app/privacy-policy.tsx-19-    body: "Some features use third-party AI providers to process your data. This may include receipt scanning, voice transcription, and maintenance recommendations. Your data may be transmitted to these providers solely to perform these functions.",
app/privacy-policy.tsx-20-  },
app/privacy-policy.tsx-21-  {
app/privacy-policy.tsx-22-    title: "4. Third-Party Services",
app/privacy-policy.tsx:23:    body: "We use trusted service providers:\n\nSupabase — data storage and infrastructure\nRevenueCat — subscription management\nAnthropic (Claude) — AI processing\nOpenAI (Whisper) — transcription\nGoogle Places API — location and address services\nNHTSA API — vehicle data\n\nThese providers process only the data necessary to provide their services.",
app/privacy-policy.tsx-24-  },
app/privacy-policy.tsx-25-  {
app/privacy-policy.tsx-26-    title: "5. Data Storage and Security",
app/privacy-policy.tsx-27-    body: "Data is stored using Supabase infrastructure, encrypted in transit and at rest. We implement reasonable safeguards to protect your data.",
app/privacy-policy.tsx-28-  },
app/privacy-policy.tsx-29-  {
app/privacy-policy.tsx-30-    title: "6. Data Retention",
app/privacy-policy.tsx-31-    body: "We retain your data until you delete your account. Some data may be retained temporarily in backups or logs for security, fraud prevention, or legal compliance.",
app/privacy-policy.tsx-32-  },
app/privacy-policy.tsx-33-  {
app/privacy-policy.tsx-34-    title: "7. Data Breach Notification",
app/privacy-policy.tsx-35-    body: "In the event of a data breach that compromises your personal information, we will notify affected users via email within 72 hours of becoming aware of the breach. We will also post a notice within the app. The notification will describe the nature of the breach, the types of data affected, and the steps we are taking to address it. If you have questions about a potential breach, contact us at support@lifemaintained.com.",
--
app/add-vehicle.tsx-25-import { useQueryClient, useQuery } from "@tanstack/react-query";
app/add-vehicle.tsx-26-import Paywall from "@/components/Paywall";
app/add-vehicle.tsx-27-import { SaveToast } from "@/components/SaveToast";
app/add-vehicle.tsx:28:import { vehicleLimit } from "@/lib/subscription";
app/add-vehicle.tsx-29-import { MILEAGE_TRACKED_TYPES, HOURS_TRACKED_TYPES, inferTrackingMode, inferTrackingModeFromVehicleType } from "@/lib/vehicleTypes";
app/add-vehicle.tsx-30-import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
app/add-vehicle.tsx-31-import { BlurView } from "expo-blur";
app/add-vehicle.tsx-32-import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from "react-native-reanimated";
app/add-vehicle.tsx-33-import { Gesture, GestureDetector } from "react-native-gesture-handler";
app/add-vehicle.tsx-34-
app/add-vehicle.tsx-35-const CURRENT_YEAR = new Date().getFullYear();
app/add-vehicle.tsx-36-const YEAR_ITEM_HEIGHT = 52;
app/add-vehicle.tsx-37-const MODEL_ITEM_HEIGHT = 52;
app/add-vehicle.tsx-38-
app/add-vehicle.tsx-39-const modelCache = new Map<string, string[]>();
app/add-vehicle.tsx-40-function modelCacheKey(make: string, year: string, vType: string): string {
--
lib/notificationScheduler.ts-175-      if (__DEV__) {
lib/notificationScheduler.ts-176-        console.log("[NotifScheduler] skipped scheduling:", { pushEnabled: false, reason: "push disabled" });
lib/notificationScheduler.ts-177-      }
lib/notificationScheduler.ts:178:      await Notifications.cancelAllScheduledNotificationsAsync();
lib/notificationScheduler.ts-179-      await Notifications.setBadgeCountAsync(0);
lib/notificationScheduler.ts-180-      return;
lib/notificationScheduler.ts-181-    }
lib/notificationScheduler.ts-182-
lib/notificationScheduler.ts-183-    const [vehiclesRes, propertiesRes, medicationsRes] = await Promise.all([
lib/notificationScheduler.ts-184-      supabase
lib/notificationScheduler.ts-185-        .from("vehicles")
lib/notificationScheduler.ts-186-        .select("id, year, make, model, nickname, mileage, hours, tracking_mode, vehicle_type, average_miles_per_month, last_mileage_update")
lib/notificationScheduler.ts-187-        .eq("user_id", userId),
lib/notificationScheduler.ts-188-      supabase
lib/notificationScheduler.ts-189-        .from("properties")
lib/notificationScheduler.ts-190-        .select("id, address, nickname")
--
lib/notificationScheduler.ts-442-      }
lib/notificationScheduler.ts-443-    }
lib/notificationScheduler.ts-444-
lib/notificationScheduler.ts:445:    await Notifications.cancelAllScheduledNotificationsAsync();
lib/notificationScheduler.ts-446-
lib/notificationScheduler.ts-447-    // ── Medication daily reminders (priority over maintenance) ──────────
lib/notificationScheduler.ts-448-    // Medications get whatever they need from the budget first.
lib/notificationScheduler.ts-449-    // Maintenance fills whatever's left.
lib/notificationScheduler.ts-450-    const enabledMedications = medications.filter(
lib/notificationScheduler.ts-451-      (m: any) => m.reminders_enabled && m.reminder_time
lib/notificationScheduler.ts-452-    );
lib/notificationScheduler.ts-453-    let medicationsScheduled = 0;
lib/notificationScheduler.ts-454-    let medicationsParseSkipped = 0;
lib/notificationScheduler.ts-455-
lib/notificationScheduler.ts-456-    for (const med of enabledMedications) {
lib/notificationScheduler.ts-457-      if (medicationsScheduled >= TOTAL_NOTIFICATION_BUDGET) {
--
app/(tabs)/home-tab.tsx-19-import { useAuth } from "@/context/AuthContext";
app/(tabs)/home-tab.tsx-20-import * as Haptics from "expo-haptics";
app/(tabs)/home-tab.tsx-21-import { parseISO, isBefore, addDays } from "date-fns";
app/(tabs)/home-tab.tsx:22:import { propertyLimit } from "@/lib/subscription";
app/(tabs)/home-tab.tsx-23-import Paywall from "@/components/Paywall";
app/(tabs)/home-tab.tsx-24-
app/(tabs)/home-tab.tsx-25-type Property = {
app/(tabs)/home-tab.tsx-26-  id: string;
app/(tabs)/home-tab.tsx-27-  address: string | null;
app/(tabs)/home-tab.tsx-28-  property_type: string | null;
app/(tabs)/home-tab.tsx-29-  year_built: number | null;
app/(tabs)/home-tab.tsx-30-  square_footage: number | null;
app/(tabs)/home-tab.tsx-31-  nickname: string | null;
app/(tabs)/home-tab.tsx-32-  is_primary_residence: boolean | null;
app/(tabs)/home-tab.tsx-33-};
app/(tabs)/home-tab.tsx-34-
--
app/(tabs)/vehicles.tsx-20-import { useAuth } from "@/context/AuthContext";
app/(tabs)/vehicles.tsx-21-import * as Haptics from "expo-haptics";
app/(tabs)/vehicles.tsx-22-import { parseISO, isBefore, addDays, differenceInDays, formatDistanceToNowStrict } from "date-fns";
app/(tabs)/vehicles.tsx:23:import { vehicleLimit } from "@/lib/subscription";
app/(tabs)/vehicles.tsx-24-import { resolveTrackingMode, isHoursTracked, isMileageTracked, currentUsageValue } from "@/lib/usageHelpers";
app/(tabs)/vehicles.tsx-25-import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
app/(tabs)/vehicles.tsx-26-import Paywall from "@/components/Paywall";
app/(tabs)/vehicles.tsx-27-
app/(tabs)/vehicles.tsx-28-type Vehicle = {
app/(tabs)/vehicles.tsx-29-  id: string;
app/(tabs)/vehicles.tsx-30-  year: number | null;
app/(tabs)/vehicles.tsx-31-  make: string | null;
app/(tabs)/vehicles.tsx-32-  model: string | null;
app/(tabs)/vehicles.tsx-33-  trim: string | null;
app/(tabs)/vehicles.tsx-34-  vehicle_type: string | null;
app/(tabs)/vehicles.tsx-35-  mileage: number | null;
--
app/family-member/[id].tsx-119-        { text: "Take Photo", onPress: () => pickMemberPhoto("camera") },
app/family-member/[id].tsx-120-        { text: "Choose from Library", onPress: () => pickMemberPhoto("library") },
app/family-member/[id].tsx-121-        { text: "Remove Photo", style: "destructive", onPress: removeMemberPhoto },
app/family-member/[id].tsx:122:        { text: "Cancel", style: "cancel" },
app/family-member/[id].tsx-123-      ]);
app/family-member/[id].tsx-124-    } else {
app/family-member/[id].tsx-125-      Alert.alert("Add Photo", "Choose an option", [
app/family-member/[id].tsx-126-        { text: "Take Photo", onPress: () => pickMemberPhoto("camera") },
app/family-member/[id].tsx-127-        { text: "Choose from Library", onPress: () => pickMemberPhoto("library") },
app/family-member/[id].tsx:128:        { text: "Cancel", style: "cancel" },
app/family-member/[id].tsx-129-      ]);
app/family-member/[id].tsx-130-    }
app/family-member/[id].tsx-131-  }
app/family-member/[id].tsx-132-
app/family-member/[id].tsx-133-  async function pickMemberPhoto(source: "camera" | "library") {
app/family-member/[id].tsx-134-    try {
app/family-member/[id].tsx-135-      const result = source === "camera"
app/family-member/[id].tsx-136-        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] })
app/family-member/[id].tsx-137-        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
app/family-member/[id].tsx:138:      if (result.canceled) return;
app/family-member/[id].tsx-139-      const uri = result.assets[0].uri;
app/family-member/[id].tsx-140-      setUploadingPhoto(true);
app/family-member/[id].tsx-141-      try {
app/family-member/[id].tsx-142-        const response = await fetch(uri);
app/family-member/[id].tsx-143-        const blob = await response.blob();
app/family-member/[id].tsx-144-        const arrayBuffer = await blob.arrayBuffer();
app/family-member/[id].tsx-145-        const storagePath = `${user!.id}/${id}.jpg`;
app/family-member/[id].tsx-146-        const { error: uploadError } = await supabase.storage
app/family-member/[id].tsx-147-          .from("profile-photos")
app/family-member/[id].tsx-148-          .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/family-member/[id].tsx-149-        if (uploadError) throw uploadError;
app/family-member/[id].tsx-150-        const { data: urlData } = supabase.storage.from("profile-photos").getPublicUrl(storagePath);
--
app/family-member/[id].tsx-180-      `Remove ${member.name}?`,
app/family-member/[id].tsx-181-      `This will delete all their appointments and medications.`,
app/family-member/[id].tsx-182-      [
app/family-member/[id].tsx:183:        { text: "Cancel", style: "cancel" },
app/family-member/[id].tsx-184-        {
app/family-member/[id].tsx-185-          text: "Delete",
app/family-member/[id].tsx-186-          style: "destructive",
app/family-member/[id].tsx-187-          onPress: async () => {
app/family-member/[id].tsx-188-            if (isDeletingMemberRef.current) return;
app/family-member/[id].tsx-189-            isDeletingMemberRef.current = true;
app/family-member/[id].tsx-190-            try {
app/family-member/[id].tsx-191-              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
app/family-member/[id].tsx-192-              await supabase.from("health_appointments").delete().eq("family_member_id", id!);
app/family-member/[id].tsx-193-              await supabase.from("medications").delete().eq("family_member_id", id!);
app/family-member/[id].tsx-194-              await supabase.from("family_members").delete().eq("id", id!);
app/family-member/[id].tsx-195-              queryClient.invalidateQueries({ queryKey: ["family_members"] });
--
app/family-member/[id].tsx-212-      "Delete Appointment",
app/family-member/[id].tsx-213-      "This appointment type will be removed from the tracker.",
app/family-member/[id].tsx-214-      [
app/family-member/[id].tsx:215:        { text: "Cancel", style: "cancel" },
app/family-member/[id].tsx-216-        {
app/family-member/[id].tsx-217-          text: "Delete",
app/family-member/[id].tsx-218-          style: "destructive",
app/family-member/[id].tsx-219-          onPress: async () => {
app/family-member/[id].tsx-220-            try {
app/family-member/[id].tsx-221-              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
app/family-member/[id].tsx-222-              await supabase.from("health_appointments").delete().eq("id", apptId);
app/family-member/[id].tsx-223-              queryClient.invalidateQueries({ queryKey: ["member_appointments", id] });
app/family-member/[id].tsx-224-              queryClient.invalidateQueries({ queryKey: ["health_appointments"] });
app/family-member/[id].tsx-225-            } catch (err: any) {
app/family-member/[id].tsx-226-              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
app/family-member/[id].tsx-227-            }
--
app/vehicle-task-history/[vehicleId].tsx-70-      "Delete Record",
app/vehicle-task-history/[vehicleId].tsx-71-      "This service record will be permanently deleted.",
app/vehicle-task-history/[vehicleId].tsx-72-      [
app/vehicle-task-history/[vehicleId].tsx:73:        { text: "Cancel", style: "cancel" },
app/vehicle-task-history/[vehicleId].tsx-74-        {
app/vehicle-task-history/[vehicleId].tsx-75-          text: "Delete",
app/vehicle-task-history/[vehicleId].tsx-76-          style: "destructive",
app/vehicle-task-history/[vehicleId].tsx-77-          onPress: async () => {
app/vehicle-task-history/[vehicleId].tsx-78-            try {
app/vehicle-task-history/[vehicleId].tsx-79-              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
app/vehicle-task-history/[vehicleId].tsx-80-              await supabase.from("maintenance_logs").delete().eq("id", logId);
app/vehicle-task-history/[vehicleId].tsx-81-              queryClient.invalidateQueries({ queryKey: ["vehicle_task_logs", vehicleId, task] });
app/vehicle-task-history/[vehicleId].tsx-82-              queryClient.invalidateQueries({ queryKey: ["maintenance_logs", vehicleId] });
app/vehicle-task-history/[vehicleId].tsx-83-            } catch (err: any) {
app/vehicle-task-history/[vehicleId].tsx-84-              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
app/vehicle-task-history/[vehicleId].tsx-85-            }
--
app/(tabs)/health.tsx-25-import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
app/(tabs)/health.tsx-26-import * as Print from "expo-print";
app/(tabs)/health.tsx-27-import * as Sharing from "expo-sharing";
app/(tabs)/health.tsx:28:import { personLimit, petLimit } from "@/lib/subscription";
app/(tabs)/health.tsx-29-import { SaveToast } from "@/components/SaveToast";
app/(tabs)/health.tsx-30-import Paywall from "@/components/Paywall";
app/(tabs)/health.tsx-31-import DatePicker from "@/components/DatePicker";
app/(tabs)/health.tsx-32-import { usePulse, S, Row, Col } from "@/components/Skeleton";
app/(tabs)/health.tsx-33-import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
app/(tabs)/health.tsx-34-
app/(tabs)/health.tsx-35-
app/(tabs)/health.tsx-36-function getStatus(nextDueDate: string | null, lastCompletedAt?: string | null): "overdue" | "due_soon" | "good" {
app/(tabs)/health.tsx-37-  if (nextDueDate) {
app/(tabs)/health.tsx-38-    const d = parseISO(nextDueDate);
app/(tabs)/health.tsx-39-    if (isBefore(d, new Date())) return "overdue";
app/(tabs)/health.tsx-40-    if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
--
app/(tabs)/health.tsx-546-                { text: "Family Member", onPress: openAddPerson },
app/(tabs)/health.tsx-547-                { text: "Appointment", onPress: () => router.push("/add-appointment") },
app/(tabs)/health.tsx-548-                { text: "Medication", onPress: () => router.push("/add-medication") },
app/(tabs)/health.tsx:549:                { text: "Cancel", style: "cancel" },
app/(tabs)/health.tsx-550-              ]);
app/(tabs)/health.tsx-551-            }}
app/(tabs)/health.tsx-552-            accessibilityLabel="Add health item"
app/(tabs)/health.tsx-553-            accessibilityRole="button"
app/(tabs)/health.tsx-554-          >
app/(tabs)/health.tsx-555-            <Ionicons name="add" size={18} color="#0C111B" />
app/(tabs)/health.tsx-556-            <Text style={styles.addHeaderBtnText}>Add</Text>
app/(tabs)/health.tsx-557-          </Pressable>
app/(tabs)/health.tsx-558-        </View>
app/(tabs)/health.tsx-559-      </View>
app/(tabs)/health.tsx-560-
app/(tabs)/health.tsx-561-      <ScrollView
--
app/(tabs)/health.tsx-600-                  <Ionicons name="person-add-outline" size={18} color={Colors.textInverse} />
app/(tabs)/health.tsx-601-                  <Text style={styles.emptyBtnText}>Add Yourself</Text>
app/(tabs)/health.tsx-602-                </Pressable>
app/(tabs)/health.tsx:603:                {profile?.subscription_tier === "free" && (
app/(tabs)/health.tsx-604-                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", marginTop: 8 }}>
app/(tabs)/health.tsx-605-                    Free plan includes limited tracking. Upgrade for more.
app/(tabs)/health.tsx-606-                  </Text>
app/(tabs)/health.tsx-607-                )}
app/(tabs)/health.tsx-608-              </View>
app/(tabs)/health.tsx-609-            ) : (
app/(tabs)/health.tsx-610-              <>
app/(tabs)/health.tsx-611-                {insightText && (
app/(tabs)/health.tsx-612-                  <View style={styles.insightCard}>
app/(tabs)/health.tsx-613-                    <Ionicons name="heart-outline" size={16} color={Colors.health} />
app/(tabs)/health.tsx-614-                    <Text style={styles.insightText}>{insightText}</Text>
app/(tabs)/health.tsx-615-                  </View>
--
app/(tabs)/settings.tsx-27-  hasPersonalOrAbove,
app/(tabs)/settings.tsx-28-  hasProOrAbove,
app/(tabs)/settings.tsx-29-  hasBusiness,
app/(tabs)/settings.tsx:30:} from "@/lib/subscription";
app/(tabs)/settings.tsx-31-
app/(tabs)/settings.tsx-32-const SETTINGS_KEY = "app_settings_v2";
app/(tabs)/settings.tsx-33-
app/(tabs)/settings.tsx-34-type AppSettings = {
app/(tabs)/settings.tsx-35-  budgetThreshold: string;
app/(tabs)/settings.tsx-36-};
app/(tabs)/settings.tsx-37-
app/(tabs)/settings.tsx-38-const DEFAULT_SETTINGS: AppSettings = {
app/(tabs)/settings.tsx-39-  budgetThreshold: "",
app/(tabs)/settings.tsx-40-};
app/(tabs)/settings.tsx-41-
app/(tabs)/settings.tsx-42-type PredVehicle = {
--
app/(tabs)/settings.tsx-311-      if (next) {
app/(tabs)/settings.tsx-312-        scheduleMaintenanceNotifications(resolvedUserId).catch(() => {});
app/(tabs)/settings.tsx-313-      } else {
app/(tabs)/settings.tsx:314:        Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
app/(tabs)/settings.tsx-315-        Notifications.setBadgeCountAsync(0).catch(() => {});
app/(tabs)/settings.tsx-316-      }
app/(tabs)/settings.tsx-317-    } finally {
app/(tabs)/settings.tsx-318-      pushTogglePendingRef.current = false;
app/(tabs)/settings.tsx-319-      setIsPushTogglePending(false);
app/(tabs)/settings.tsx-320-    }
app/(tabs)/settings.tsx-321-  }
app/(tabs)/settings.tsx-322-
app/(tabs)/settings.tsx-323-  async function handleSave() {
app/(tabs)/settings.tsx-324-    if (!user || !hasChanges) return;
app/(tabs)/settings.tsx-325-    setIsSaving(true);
app/(tabs)/settings.tsx-326-    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
--
app/(tabs)/settings.tsx-350-
app/(tabs)/settings.tsx-351-  async function handleSignOut() {
app/(tabs)/settings.tsx-352-    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
app/(tabs)/settings.tsx:353:      { text: "Cancel", style: "cancel" },
app/(tabs)/settings.tsx-354-      {
app/(tabs)/settings.tsx-355-        text: "Sign Out",
app/(tabs)/settings.tsx-356-        style: "destructive",
app/(tabs)/settings.tsx-357-        onPress: async () => {
app/(tabs)/settings.tsx-358-          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
app/(tabs)/settings.tsx-359-          await signOut();
app/(tabs)/settings.tsx-360-          router.replace("/(auth)");
app/(tabs)/settings.tsx-361-        },
app/(tabs)/settings.tsx-362-      },
app/(tabs)/settings.tsx-363-    ]);
app/(tabs)/settings.tsx-364-  }
app/(tabs)/settings.tsx-365-
--
app/(tabs)/settings.tsx-369-      "Delete Account",
app/(tabs)/settings.tsx-370-      "This will permanently delete your account and all data. This cannot be undone.",
app/(tabs)/settings.tsx-371-      [
app/(tabs)/settings.tsx:372:        { text: "Cancel", style: "cancel" },
app/(tabs)/settings.tsx-373-        {
app/(tabs)/settings.tsx-374-          text: "Delete Forever",
app/(tabs)/settings.tsx-375-          style: "destructive",
app/(tabs)/settings.tsx-376-          onPress: () => {
app/(tabs)/settings.tsx-377-            Alert.alert("Are you absolutely sure?", "All vehicles, properties, health records, and history will be deleted.", [
app/(tabs)/settings.tsx:378:              { text: "Cancel", style: "cancel" },
app/(tabs)/settings.tsx-379-              {
app/(tabs)/settings.tsx-380-                text: "Yes, Delete My Account",
app/(tabs)/settings.tsx-381-                style: "destructive",
app/(tabs)/settings.tsx-382-                onPress: async () => {
app/(tabs)/settings.tsx-383-                  if (isDeletingAccountRef.current) return;
app/(tabs)/settings.tsx-384-                  isDeletingAccountRef.current = true;
app/(tabs)/settings.tsx-385-                  try {
app/(tabs)/settings.tsx-386-                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
app/(tabs)/settings.tsx-387-                    if (!user) return;
app/(tabs)/settings.tsx-388-                    const { data: { session } } = await supabase.auth.getSession();
app/(tabs)/settings.tsx-389-                    const { data, error } = await supabase.functions.invoke("delete-account", {
app/(tabs)/settings.tsx-390-                      headers: { Authorization: `Bearer ${session?.access_token}` },
--
app/(tabs)/settings.tsx-418-  }
app/(tabs)/settings.tsx-419-
app/(tabs)/settings.tsx-420-  const userIsInTrial =
app/(tabs)/settings.tsx:421:    profile?.subscription_tier === "trial" ||
app/(tabs)/settings.tsx:422:    (!!profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date());
app/(tabs)/settings.tsx:423:  const trialDaysLeft = profile?.trial_expires_at
app/(tabs)/settings.tsx:424:    ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
app/(tabs)/settings.tsx-425-    : 0;
app/(tabs)/settings.tsx-426-  const isPremium = hasPersonalOrAbove(profile);
app/(tabs)/settings.tsx-427-  const userIsFreeTier = !userIsInTrial && !isPremium;
app/(tabs)/settings.tsx-428-  const tierLabel = userIsInTrial ? "Trial" : hasBusiness(profile) ? "Business" : hasProOrAbove(profile) ? "Pro" : hasPersonalOrAbove(profile) ? "Personal" : "Free";
app/(tabs)/settings.tsx:429:  const expiryDate = profile?.subscription_expires_at ? parseISO(profile.subscription_expires_at) : null;
app/(tabs)/settings.tsx-430-  const isLifetime = expiryDate != null && expiryDate.getFullYear() - new Date().getFullYear() > 50;
app/(tabs)/settings.tsx-431-  const tierExpiry = expiryDate && !isLifetime ? format(expiryDate, "MMMM d, yyyy") : null;
app/(tabs)/settings.tsx-432-  const tierExpiryLabel = isLifetime
app/(tabs)/settings.tsx-433-    ? "Lifetime"
app/(tabs)/settings.tsx-434-    : tierExpiry
app/(tabs)/settings.tsx-435-      ? (expiryDate! > new Date() ? `Renews ${tierExpiry}` : `Expires ${tierExpiry}`)
app/(tabs)/settings.tsx:436:      : "Active subscription";
app/(tabs)/settings.tsx-437-
app/(tabs)/settings.tsx-438-  if (!isLoaded) {
app/(tabs)/settings.tsx-439-    return (
app/(tabs)/settings.tsx-440-      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
app/(tabs)/settings.tsx-441-        <ActivityIndicator color={Colors.accent} />
app/(tabs)/settings.tsx-442-      </View>
app/(tabs)/settings.tsx-443-    );
app/(tabs)/settings.tsx-444-  }
app/(tabs)/settings.tsx-445-
app/(tabs)/settings.tsx-446-  return (
app/(tabs)/settings.tsx-447-    <View style={{ flex: 1, backgroundColor: Colors.background }}>
app/(tabs)/settings.tsx-448-      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
--
app/(tabs)/settings.tsx-463-            <View style={styles.banner}>
app/(tabs)/settings.tsx-464-              <View style={styles.bannerText}>
app/(tabs)/settings.tsx-465-                <Text style={styles.bannerTitle}>Free Trial</Text>
app/(tabs)/settings.tsx:466:                <Text style={styles.bannerSub}>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining</Text>
app/(tabs)/settings.tsx-467-              </View>
app/(tabs)/settings.tsx-468-              <Pressable
app/(tabs)/settings.tsx-469-                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
app/(tabs)/settings.tsx:470:                onPress={() => router.push("/subscription" as any)}
app/(tabs)/settings.tsx-471-              >
app/(tabs)/settings.tsx-472-                <Text style={styles.bannerBtnText}>Upgrade</Text>
app/(tabs)/settings.tsx-473-              </Pressable>
app/(tabs)/settings.tsx-474-            </View>
app/(tabs)/settings.tsx-475-          )}
app/(tabs)/settings.tsx-476-
app/(tabs)/settings.tsx-477-          {userIsFreeTier && !userIsInTrial && (
app/(tabs)/settings.tsx-478-            <View style={styles.banner}>
app/(tabs)/settings.tsx-479-              <View style={styles.bannerText}>
app/(tabs)/settings.tsx-480-                <Text style={styles.bannerTitle}>Free Plan</Text>
app/(tabs)/settings.tsx-481-                <Text style={styles.bannerSub}>Upgrade to unlock vehicles, scans & exports</Text>
app/(tabs)/settings.tsx-482-              </View>
app/(tabs)/settings.tsx-483-              <Pressable
app/(tabs)/settings.tsx-484-                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
app/(tabs)/settings.tsx:485:                onPress={() => router.push("/subscription" as any)}
app/(tabs)/settings.tsx-486-              >
app/(tabs)/settings.tsx-487-                <Text style={styles.bannerBtnText}>Upgrade</Text>
app/(tabs)/settings.tsx-488-              </Pressable>
app/(tabs)/settings.tsx-489-            </View>
app/(tabs)/settings.tsx-490-          )}
app/(tabs)/settings.tsx-491-
app/(tabs)/settings.tsx-492-          {isPremium && !userIsInTrial && (
app/(tabs)/settings.tsx-493-            <View style={styles.banner}>
app/(tabs)/settings.tsx-494-              <View style={styles.bannerText}>
app/(tabs)/settings.tsx-495-                <Text style={styles.bannerTitle}>{tierLabel} Plan</Text>
app/(tabs)/settings.tsx-496-                <Text style={styles.bannerSub}>{tierExpiryLabel}</Text>
app/(tabs)/settings.tsx-497-              </View>
--
app/(tabs)/settings.tsx-730-                  style={({ pressed }) => [styles.legalBtn, { opacity: pressed ? 0.7 : 1 }]}
app/(tabs)/settings.tsx-731-                  onPress={() => {
app/(tabs)/settings.tsx-732-                    const { Linking } = require("react-native");
app/(tabs)/settings.tsx:733:                    Linking.openURL("itms-apps://apps.apple.com/account/subscriptions");
app/(tabs)/settings.tsx-734-                  }}
app/(tabs)/settings.tsx-735-                >
app/(tabs)/settings.tsx:736:                  <Text style={styles.legalBtnText}>Manage Subscription</Text>
app/(tabs)/settings.tsx-737-                </Pressable>
app/(tabs)/settings.tsx-738-              </>
app/(tabs)/settings.tsx-739-            )}
app/(tabs)/settings.tsx-740-          </View>
app/(tabs)/settings.tsx-741-
app/(tabs)/settings.tsx-742-          <Text style={styles.version}>LifeMaintained v1.0.0</Text>
app/(tabs)/settings.tsx-743-
app/(tabs)/settings.tsx-744-          <View style={{ height: 32 }} />
app/(tabs)/settings.tsx-745-          <Pressable
app/(tabs)/settings.tsx-746-            style={({ pressed }) => [styles.deleteAccountBtn, { opacity: pressed ? 0.7 : 1 }]}
app/(tabs)/settings.tsx-747-            onPress={handleDeleteAccount}
app/(tabs)/settings.tsx-748-            hitSlop={8}
--
app/vehicle/[id].tsx-33-import { parseISO, isBefore, addMonths, format, formatDistanceToNowStrict, differenceInDays } from "date-fns";
app/vehicle/[id].tsx-34-import { useAuth } from "@/context/AuthContext";
app/vehicle/[id].tsx-35-import Paywall from "@/components/Paywall";
app/vehicle/[id].tsx:36:import { hasPersonalOrAbove } from "@/lib/subscription";
app/vehicle/[id].tsx-37-import { SaveToast } from "@/components/SaveToast";
app/vehicle/[id].tsx-38-import DatePicker from "@/components/DatePicker";
app/vehicle/[id].tsx-39-import { HOURS_TRACKED_TYPES, MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";
app/vehicle/[id].tsx-40-import { formatShopAndDiy } from "@/lib/costFormat";
app/vehicle/[id].tsx-41-import {
app/vehicle/[id].tsx-42-  resolveTrackingMode,
app/vehicle/[id].tsx-43-  isHoursTracked,
app/vehicle/[id].tsx-44-  isMileageTracked,
app/vehicle/[id].tsx-45-  isTimeOnly,
app/vehicle/[id].tsx-46-  currentUsageValue,
app/vehicle/[id].tsx-47-  formatUsageValue,
app/vehicle/[id].tsx-48-  taskNextDueUsage,
--
app/vehicle/[id].tsx-549-      "Refresh maintenance schedule?",
app/vehicle/[id].tsx-550-      "We'll rebuild this vehicle's recommended schedule using your current mileage, service history, and the latest improvements. Your service history and custom tasks will be kept.",
app/vehicle/[id].tsx-551-      [
app/vehicle/[id].tsx:552:        { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-553-        { text: "Refresh", onPress: refreshSchedule },
app/vehicle/[id].tsx-554-      ],
app/vehicle/[id].tsx-555-    );
app/vehicle/[id].tsx-556-  }
app/vehicle/[id].tsx-557-
app/vehicle/[id].tsx-558-  function showToast(msg: string, isError = false, subtitle?: string) {
app/vehicle/[id].tsx-559-    setScheduleToast(msg);
app/vehicle/[id].tsx-560-    setScheduleToastSubtitle(subtitle);
app/vehicle/[id].tsx-561-    setScheduleToastIsError(isError);
app/vehicle/[id].tsx-562-    setShowScheduleToast(true);
app/vehicle/[id].tsx-563-    setTimeout(() => setShowScheduleToast(false), 2800);
app/vehicle/[id].tsx-564-  }
--
app/vehicle/[id].tsx-804-          { text: "Take New Photo", onPress: () => pickVehiclePhoto("camera") },
app/vehicle/[id].tsx-805-          { text: "Choose from Library", onPress: () => pickVehiclePhoto("library") },
app/vehicle/[id].tsx-806-          { text: "Remove Photo", style: "destructive" as const, onPress: removeVehiclePhoto },
app/vehicle/[id].tsx:807:          { text: "Cancel", style: "cancel" as const },
app/vehicle/[id].tsx-808-        ]
app/vehicle/[id].tsx-809-      : [
app/vehicle/[id].tsx-810-          { text: "Take Photo", onPress: () => pickVehiclePhoto("camera") },
app/vehicle/[id].tsx-811-          { text: "Choose from Library", onPress: () => pickVehiclePhoto("library") },
app/vehicle/[id].tsx:812:          { text: "Cancel", style: "cancel" as const },
app/vehicle/[id].tsx-813-        ];
app/vehicle/[id].tsx-814-    Alert.alert("Vehicle Photo", "Choose a photo source", options);
app/vehicle/[id].tsx-815-  }
app/vehicle/[id].tsx-816-
app/vehicle/[id].tsx-817-  async function pickVehiclePhoto(source: "camera" | "library") {
app/vehicle/[id].tsx-818-    setUploadingPhoto(true);
app/vehicle/[id].tsx-819-    try {
app/vehicle/[id].tsx-820-      let result;
app/vehicle/[id].tsx-821-      if (source === "camera") {
app/vehicle/[id].tsx-822-        const { status } = await ImagePicker.requestCameraPermissionsAsync();
app/vehicle/[id].tsx-823-        if (status !== "granted") {
app/vehicle/[id].tsx-824-          Alert.alert("Camera access needed", "Turn on camera access in your Settings to take photos.");
--
app/vehicle/[id].tsx-828-      } else {
app/vehicle/[id].tsx-829-        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
app/vehicle/[id].tsx-830-      }
app/vehicle/[id].tsx:831:      if (result.canceled || !result.assets?.[0]) return;
app/vehicle/[id].tsx-832-
app/vehicle/[id].tsx-833-      const uri = result.assets[0].uri;
app/vehicle/[id].tsx-834-      const storagePath = `${user!.id}/${id}/vehicle-photo.jpg`;
app/vehicle/[id].tsx-835-      const response = await fetch(uri);
app/vehicle/[id].tsx-836-      const blob = await response.blob();
app/vehicle/[id].tsx-837-      const arrayBuffer = await new Response(blob).arrayBuffer();
app/vehicle/[id].tsx-838-
app/vehicle/[id].tsx-839-      const { error: uploadError } = await supabase.storage
app/vehicle/[id].tsx-840-        .from("wallet-documents")
app/vehicle/[id].tsx-841-        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/vehicle/[id].tsx-842-      if (uploadError) throw uploadError;
app/vehicle/[id].tsx-843-
--
app/vehicle/[id].tsx-968-      "Delete this vehicle?",
app/vehicle/[id].tsx-969-      `This will permanently delete all maintenance tasks and service history for ${name}.`,
app/vehicle/[id].tsx-970-      [
app/vehicle/[id].tsx:971:        { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-972-        {
app/vehicle/[id].tsx-973-          text: "Delete",
app/vehicle/[id].tsx-974-          style: "destructive",
app/vehicle/[id].tsx-975-          onPress: () => {
app/vehicle/[id].tsx-976-            const vehicleId = id!;
app/vehicle/[id].tsx-977-            const userId = user!.id;
app/vehicle/[id].tsx-978-
app/vehicle/[id].tsx-979-            // Optimistically remove from cache (safe handling)
app/vehicle/[id].tsx-980-            queryClient.setQueryData(["vehicles", userId], (old: any) => {
app/vehicle/[id].tsx-981-              if (!old) return old;
app/vehicle/[id].tsx-982-
app/vehicle/[id].tsx-983-              // Handle array case
--
app/vehicle/[id].tsx-1047-    Alert.alert("Export Service History", "Choose a format for resale documentation", [
app/vehicle/[id].tsx-1048-      { text: "PDF", onPress: () => exportHistory("pdf") },
app/vehicle/[id].tsx-1049-      { text: "CSV", onPress: () => exportHistory("csv") },
app/vehicle/[id].tsx:1050:      { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-1051-    ]);
app/vehicle/[id].tsx-1052-  }
app/vehicle/[id].tsx-1053-
app/vehicle/[id].tsx-1054-  const isLoading = loadingVehicle;
app/vehicle/[id].tsx-1055-  const vehicleName = vehicle ? (vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`) : "Vehicle";
app/vehicle/[id].tsx-1056-
app/vehicle/[id].tsx-1057-  const groupedHistory = useMemo(() => {
app/vehicle/[id].tsx-1058-    if (!logs || logs.length === 0) return [];
app/vehicle/[id].tsx-1059-    const map = new Map<string, any[]>();
app/vehicle/[id].tsx-1060-    for (const log of logs) {
app/vehicle/[id].tsx-1061-      const key = (log.service_name ?? "Other Service").trim();
app/vehicle/[id].tsx-1062-      if (!map.has(key)) map.set(key, []);
--
app/vehicle/[id].tsx-2553-        });
app/vehicle/[id].tsx-2554-      }
app/vehicle/[id].tsx-2555-
app/vehicle/[id].tsx:2556:      if (result.canceled || !result.assets?.[0]) return;
app/vehicle/[id].tsx-2557-
app/vehicle/[id].tsx-2558-      const uri = result.assets[0].uri;
app/vehicle/[id].tsx-2559-      const storagePath = `${userId}/${vehicleId}/${docType}.jpg`;
app/vehicle/[id].tsx-2560-
app/vehicle/[id].tsx-2561-      const response = await fetch(uri);
app/vehicle/[id].tsx-2562-      const blob = await response.blob();
app/vehicle/[id].tsx-2563-      const arrayBuffer = await new Response(blob).arrayBuffer();
app/vehicle/[id].tsx-2564-
app/vehicle/[id].tsx-2565-      const { error: uploadError } = await supabase.storage
app/vehicle/[id].tsx-2566-        .from("wallet-documents")
app/vehicle/[id].tsx-2567-        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
app/vehicle/[id].tsx-2568-      if (uploadError) throw uploadError;
--
app/vehicle/[id].tsx-2610-      [
app/vehicle/[id].tsx-2611-        { text: "Take Photo", onPress: () => handlePick(docType, "camera") },
app/vehicle/[id].tsx-2612-        { text: "Choose from Library", onPress: () => handlePick(docType, "library") },
app/vehicle/[id].tsx:2613:        { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-2614-      ],
app/vehicle/[id].tsx-2615-    );
app/vehicle/[id].tsx-2616-  }
app/vehicle/[id].tsx-2617-
app/vehicle/[id].tsx-2618-  async function handleDelete(docType: DocType) {
app/vehicle/[id].tsx-2619-    const doc = getDoc(docType);
app/vehicle/[id].tsx-2620-    if (!doc) return;
app/vehicle/[id].tsx-2621-    Alert.alert(
app/vehicle/[id].tsx-2622-      "Delete Photo",
app/vehicle/[id].tsx-2623-      `Remove the ${DOC_LABELS[docType]} photo from your wallet?`,
app/vehicle/[id].tsx-2624-      [
app/vehicle/[id].tsx:2625:        { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-2626-        {
app/vehicle/[id].tsx-2627-          text: "Delete",
app/vehicle/[id].tsx-2628-          style: "destructive",
app/vehicle/[id].tsx-2629-          onPress: async () => {
app/vehicle/[id].tsx-2630-            try {
app/vehicle/[id].tsx-2631-              const storagePath = `${userId}/${vehicleId}/${docType}.jpg`;
app/vehicle/[id].tsx-2632-              await supabase.storage.from("wallet-documents").remove([storagePath]);
app/vehicle/[id].tsx-2633-              await supabase.from("vehicle_wallet_documents").delete().eq("id", doc.id);
app/vehicle/[id].tsx-2634-              await refetch();
app/vehicle/[id].tsx-2635-            } catch {
app/vehicle/[id].tsx-2636-              showWalletToast("Photo didn't delete", "Try again in a moment.", true);
app/vehicle/[id].tsx-2637-            }
--
app/vehicle/[id].tsx-2649-      [
app/vehicle/[id].tsx-2650-        { text: "Replace Photo", onPress: () => showPickerOptions(docType) },
app/vehicle/[id].tsx-2651-        { text: "Delete", style: "destructive", onPress: () => handleDelete(docType) },
app/vehicle/[id].tsx:2652:        { text: "Cancel", style: "cancel" },
app/vehicle/[id].tsx-2653-      ],
app/vehicle/[id].tsx-2654-    );
app/vehicle/[id].tsx-2655-  }
app/vehicle/[id].tsx-2656-
app/vehicle/[id].tsx-2657-  if (isLoading) {
app/vehicle/[id].tsx-2658-    return (
app/vehicle/[id].tsx-2659-      <View style={walletStyles.loading}>
app/vehicle/[id].tsx-2660-        <ActivityIndicator color={Colors.accent} />
app/vehicle/[id].tsx-2661-      </View>
app/vehicle/[id].tsx-2662-    );
app/vehicle/[id].tsx-2663-  }
app/vehicle/[id].tsx-2664-
```

### B8. Cross-vertical premium teaser and locked-preview surfaces

```
lib/supabase-types.ts-736-      }
lib/supabase-types.ts-737-      profiles: {
lib/supabase-types.ts-738-        Row: {
lib/supabase-types.ts:739:          beta_premium_until: string | null
lib/supabase-types.ts-740-          budget_notifications_enabled: boolean | null
lib/supabase-types.ts-741-          created_at: string
lib/supabase-types.ts-742-          email: string | null
lib/supabase-types.ts-743-          id: string
lib/supabase-types.ts-744-          is_beta_user: boolean | null
lib/supabase-types.ts-745-          monthly_scan_count: number
lib/supabase-types.ts-746-          onboarding_completed: boolean | null
lib/supabase-types.ts-747-          onboarding_data: Json | null
lib/supabase-types.ts-748-          onboarding_selections: string[] | null
lib/supabase-types.ts-749-          onboarding_step: number | null
lib/supabase-types.ts-750-          push_token: string | null
lib/supabase-types.ts-751-          revenuecat_customer_id: string | null
--
lib/supabase-types.ts-765-          zip_code: string | null
lib/supabase-types.ts-766-        }
lib/supabase-types.ts-767-        Insert: {
lib/supabase-types.ts:768:          beta_premium_until?: string | null
lib/supabase-types.ts-769-          budget_notifications_enabled?: boolean | null
lib/supabase-types.ts-770-          created_at?: string
lib/supabase-types.ts-771-          email?: string | null
lib/supabase-types.ts-772-          id?: string
lib/supabase-types.ts-773-          is_beta_user?: boolean | null
lib/supabase-types.ts-774-          monthly_scan_count?: number
lib/supabase-types.ts-775-          onboarding_completed?: boolean | null
lib/supabase-types.ts-776-          onboarding_data?: Json | null
lib/supabase-types.ts-777-          onboarding_selections?: string[] | null
lib/supabase-types.ts-778-          onboarding_step?: number | null
lib/supabase-types.ts-779-          push_token?: string | null
lib/supabase-types.ts-780-          revenuecat_customer_id?: string | null
--
lib/supabase-types.ts-794-          zip_code?: string | null
lib/supabase-types.ts-795-        }
lib/supabase-types.ts-796-        Update: {
lib/supabase-types.ts:797:          beta_premium_until?: string | null
lib/supabase-types.ts-798-          budget_notifications_enabled?: boolean | null
lib/supabase-types.ts-799-          created_at?: string
lib/supabase-types.ts-800-          email?: string | null
lib/supabase-types.ts-801-          id?: string
lib/supabase-types.ts-802-          is_beta_user?: boolean | null
lib/supabase-types.ts-803-          monthly_scan_count?: number
lib/supabase-types.ts-804-          onboarding_completed?: boolean | null
lib/supabase-types.ts-805-          onboarding_data?: Json | null
lib/supabase-types.ts-806-          onboarding_selections?: string[] | null
lib/supabase-types.ts-807-          onboarding_step?: number | null
lib/supabase-types.ts-808-          push_token?: string | null
lib/supabase-types.ts-809-          revenuecat_customer_id?: string | null
--
app/add-property.tsx-575-        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-property.tsx-576-          <Paywall
app/add-property.tsx-577-            canDismiss
app/add-property.tsx:578:            subtitle="Upgrade to add more properties"
app/add-property.tsx-579-            onDismiss={() => setShowPaywall(false)}
app/add-property.tsx-580-          />
app/add-property.tsx-581-        </Modal>
app/add-property.tsx-582-      )}
app/add-property.tsx-583-    </KeyboardAvoidingView>
app/add-property.tsx-584-  );
app/add-property.tsx-585-}
app/add-property.tsx-586-
app/add-property.tsx-587-function StatePickerModal({ visible, selected, onSelect, onClose, insets }: {
app/add-property.tsx-588-  visible: boolean;
app/add-property.tsx-589-  selected: string;
app/add-property.tsx-590-  onSelect: (abbr: string) => void;
--
lib/subscription.ts-16-
lib/subscription.ts-17-const PAID_TIERS = ["personal", "pro", "business"];
lib/subscription.ts-18-
lib/subscription.ts:19:export function hasActivePremium(profile: Profile | null | undefined): boolean {
lib/subscription.ts-20-  if (!profile) return false;
lib/subscription.ts-21-  try {
lib/subscription.ts-22-    if (
lib/subscription.ts-23-      profile.subscription_tier === "trial" &&
lib/subscription.ts-24-      profile.trial_expires_at &&
lib/subscription.ts-25-      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts-26-    ) return true;
lib/subscription.ts-27-
lib/subscription.ts-28-    if (
lib/subscription.ts-29-      PAID_TIERS.includes(profile.subscription_tier ?? "") &&
lib/subscription.ts-30-      profile.subscription_expires_at &&
lib/subscription.ts-31-      new Date(profile.subscription_expires_at) > new Date()
--
lib/subscription.ts-38-}
lib/subscription.ts-39-
lib/subscription.ts-40-export function hasPersonalOrAbove(profile: Profile | null | undefined): boolean {
lib/subscription.ts:41:  return hasActivePremium(profile);
lib/subscription.ts-42-}
lib/subscription.ts-43-
lib/subscription.ts-44-export function hasProOrAbove(profile: Profile | null | undefined): boolean {
lib/subscription.ts-45-  if (!profile) return false;
lib/subscription.ts-46-  try {
lib/subscription.ts-47-    if (
lib/subscription.ts-48-      profile.subscription_tier === "trial" &&
lib/subscription.ts-49-      profile.trial_expires_at &&
lib/subscription.ts-50-      new Date(profile.trial_expires_at) > new Date()
lib/subscription.ts-51-    ) return true;
lib/subscription.ts-52-    if (
lib/subscription.ts-53-      ["pro", "business"].includes(profile.subscription_tier ?? "") &&
--
lib/subscription.ts-122-}
lib/subscription.ts-123-
lib/subscription.ts-124-export function isFreeTier(profile: Profile | null | undefined): boolean {
lib/subscription.ts:125:  return !hasActivePremium(profile);
lib/subscription.ts-126-}
lib/subscription.ts-127-
lib/subscription.ts-128-/**
lib/subscription.ts-129- * Legacy UI helper only.
lib/subscription.ts-130- * Receipt scan enforcement no longer relies on profile.monthly_scan_count.
lib/subscription.ts-131- */
lib/subscription.ts-132-export function scansRemaining(profile: Profile | null | undefined): number {
lib/subscription.ts-133-  return Math.max(0, scanLimit(profile) - ((profile?.monthly_scan_count) ?? 0));
lib/subscription.ts-134-}
lib/subscription.ts-135-
lib/subscription.ts-136-export function trialDaysRemaining(profile: Profile | null | undefined): number {
lib/subscription.ts-137-  if (!profile || !isInTrial(profile) || !profile.trial_expires_at) return 0;
--
components/TrialBanner.tsx-55-          </Text>
components/TrialBanner.tsx-56-        </View>
components/TrialBanner.tsx-57-        <View style={styles.cta}>
components/TrialBanner.tsx:58:          <Text style={styles.ctaText}>Upgrade</Text>
components/TrialBanner.tsx-59-          <Ionicons name="chevron-forward" size={12} color={Colors.accent} />
components/TrialBanner.tsx-60-        </View>
components/TrialBanner.tsx-61-      </Pressable>
components/TrialBanner.tsx-62-    </Animated.View>
components/TrialBanner.tsx-63-  );
components/TrialBanner.tsx-64-}
components/TrialBanner.tsx-65-
components/TrialBanner.tsx-66-const styles = StyleSheet.create({
components/TrialBanner.tsx-67-  container: {
components/TrialBanner.tsx-68-    marginHorizontal: 16,
components/TrialBanner.tsx-69-    marginBottom: 8,
components/TrialBanner.tsx-70-    borderRadius: 12,
--
components/Paywall.tsx-489-          <View style={styles.closeBtn} />
components/Paywall.tsx-490-        )}
components/Paywall.tsx-491-        <View style={styles.headerCenter}>
components/Paywall.tsx:492:          <Text style={styles.headerTitle}>LifeMaintained Premium</Text>
components/Paywall.tsx-493-          <Text style={styles.headerSubtitle}>{subtitle}</Text>
components/Paywall.tsx-494-        </View>
components/Paywall.tsx-495-        <View style={styles.closeBtn} />
components/Paywall.tsx-496-      </View>
components/Paywall.tsx-497-
components/Paywall.tsx-498-      {loadingOfferings ? (
components/Paywall.tsx-499-        <View style={styles.loadingContainer}>
components/Paywall.tsx-500-          <ActivityIndicator color={Colors.accent} size="large" />
components/Paywall.tsx-501-        </View>
components/Paywall.tsx-502-      ) : offeringsError ? (
components/Paywall.tsx-503-        <View style={styles.offeringsErrorContainer}>
components/Paywall.tsx-504-          <View style={styles.offeringsErrorIcon}>
--
app/log-service/[vehicleId].tsx-456-              >
app/log-service/[vehicleId].tsx-457-                <Ionicons name="camera-outline" size={16} color={Colors.accent} />
app/log-service/[vehicleId].tsx-458-                <Text style={styles.scanGateBtnText}>Scan Receipt</Text>
app/log-service/[vehicleId].tsx:459:                <View style={styles.scanLockedBadge}>
app/log-service/[vehicleId].tsx-460-                  <Ionicons name="lock-closed" size={10} color={Colors.textInverse} />
app/log-service/[vehicleId].tsx:461:                  <Text style={styles.scanLockedText}>Upgrade</Text>
app/log-service/[vehicleId].tsx-462-                </View>
app/log-service/[vehicleId].tsx-463-              </Pressable>
app/log-service/[vehicleId].tsx-464-            ) : (
app/log-service/[vehicleId].tsx-465-              <ReceiptScanButton
app/log-service/[vehicleId].tsx-466-                assetType="vehicle"
app/log-service/[vehicleId].tsx-467-                assetId={vehicleId}
app/log-service/[vehicleId].tsx-468-                onScanComplete={handleScanComplete}
app/log-service/[vehicleId].tsx-469-                onScanLimitReached={() => setShowPaywall(true)}
app/log-service/[vehicleId].tsx-470-                onPaidUserAtCap={() => setShowScanPackModal(true)}
app/log-service/[vehicleId].tsx-471-              />
app/log-service/[vehicleId].tsx-472-            )}
app/log-service/[vehicleId].tsx-473-          </View>
--
app/log-service/[vehicleId].tsx-693-        <Modal visible animationType="slide" onRequestClose={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}>
app/log-service/[vehicleId].tsx-694-          <Paywall
app/log-service/[vehicleId].tsx-695-            canDismiss
app/log-service/[vehicleId].tsx:696:            subtitle="Upgrade to scan receipts with AI"
app/log-service/[vehicleId].tsx-697-            onDismiss={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
app/log-service/[vehicleId].tsx-698-          />
app/log-service/[vehicleId].tsx-699-        </Modal>
app/log-service/[vehicleId].tsx-700-      )}
app/log-service/[vehicleId].tsx-701-      <ScanPackModal
app/log-service/[vehicleId].tsx-702-        visible={showScanPackModal}
app/log-service/[vehicleId].tsx-703-        onClose={() => setShowScanPackModal(false)}
app/log-service/[vehicleId].tsx-704-        onSuccess={() => setShowScanPackModal(false)}
app/log-service/[vehicleId].tsx-705-      />
app/log-service/[vehicleId].tsx-706-      <SaveToast visible={successToastVisible} message={successToastTitle} subtitle={successToastSubtitle} />
app/log-service/[vehicleId].tsx-707-    </KeyboardAvoidingView>
app/log-service/[vehicleId].tsx-708-  );
--
app/log-service/[vehicleId].tsx-818-    borderColor: Colors.accent + "33",
app/log-service/[vehicleId].tsx-819-  },
app/log-service/[vehicleId].tsx-820-  scanGateBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.accent },
app/log-service/[vehicleId].tsx:821:  scanLockedBadge: {
app/log-service/[vehicleId].tsx-822-    flexDirection: "row",
app/log-service/[vehicleId].tsx-823-    alignItems: "center",
app/log-service/[vehicleId].tsx-824-    gap: 4,
app/log-service/[vehicleId].tsx-825-    backgroundColor: Colors.accent,
app/log-service/[vehicleId].tsx-826-    borderRadius: 10,
app/log-service/[vehicleId].tsx-827-    paddingHorizontal: 8,
app/log-service/[vehicleId].tsx-828-    paddingVertical: 3,
app/log-service/[vehicleId].tsx-829-  },
app/log-service/[vehicleId].tsx:830:  scanLockedText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
app/log-service/[vehicleId].tsx-831-  scanBadgeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
app/log-service/[vehicleId].tsx-832-  scanBadgeText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dueSoon },
app/log-service/[vehicleId].tsx-833-  itemRow: {
app/log-service/[vehicleId].tsx-834-    flexDirection: "row",
app/log-service/[vehicleId].tsx-835-    alignItems: "center",
app/log-service/[vehicleId].tsx-836-    backgroundColor: Colors.card,
app/log-service/[vehicleId].tsx-837-    borderRadius: 14,
app/log-service/[vehicleId].tsx-838-    padding: 12,
app/log-service/[vehicleId].tsx-839-    borderWidth: 1,
app/log-service/[vehicleId].tsx-840-    borderColor: Colors.border,
app/log-service/[vehicleId].tsx-841-    gap: 8,
app/log-service/[vehicleId].tsx-842-  },
--
app/add-family-member.tsx-203-        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-family-member.tsx-204-          <Paywall
app/add-family-member.tsx-205-            canDismiss
app/add-family-member.tsx:206:            subtitle="Upgrade to add unlimited family members"
app/add-family-member.tsx-207-            onDismiss={() => setShowPaywall(false)}
app/add-family-member.tsx-208-          />
app/add-family-member.tsx-209-        </Modal>
app/add-family-member.tsx-210-      )}
app/add-family-member.tsx-211-    </KeyboardAvoidingView>
app/add-family-member.tsx-212-  );
app/add-family-member.tsx-213-}
app/add-family-member.tsx-214-
app/add-family-member.tsx-215-const styles = StyleSheet.create({
app/add-family-member.tsx-216-  container: { flex: 1 },
app/add-family-member.tsx-217-  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
app/add-family-member.tsx-218-  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
--
app/add-vehicle.tsx-2171-        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/add-vehicle.tsx-2172-          <Paywall
app/add-vehicle.tsx-2173-            canDismiss
app/add-vehicle.tsx:2174:            subtitle="Upgrade to add more vehicles"
app/add-vehicle.tsx-2175-            onDismiss={() => setShowPaywall(false)}
app/add-vehicle.tsx-2176-          />
app/add-vehicle.tsx-2177-        </Modal>
app/add-vehicle.tsx-2178-      )}
app/add-vehicle.tsx-2179-
app/add-vehicle.tsx-2180-      <CopyFromVehicleModal
app/add-vehicle.tsx-2181-        visible={showCopyModal}
app/add-vehicle.tsx-2182-        newVehicleId={savedVehicleId}
app/add-vehicle.tsx-2183-        userId={user?.id ?? ""}
app/add-vehicle.tsx-2184-        candidates={walletCandidates ?? []}
app/add-vehicle.tsx-2185-        onClose={() => {
app/add-vehicle.tsx-2186-          setShowCopyModal(false);
--
app/vehicle/[id].tsx-1697-        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
app/vehicle/[id].tsx-1698-          <Paywall
app/vehicle/[id].tsx-1699-            canDismiss
app/vehicle/[id].tsx:1700:            subtitle="Upgrade to export your service history"
app/vehicle/[id].tsx-1701-            onDismiss={() => setShowPaywall(false)}
app/vehicle/[id].tsx-1702-          />
app/vehicle/[id].tsx-1703-        </Modal>
app/vehicle/[id].tsx-1704-      )}
app/vehicle/[id].tsx-1705-    </View>
app/vehicle/[id].tsx-1706-  );
app/vehicle/[id].tsx-1707-}
app/vehicle/[id].tsx-1708-
app/vehicle/[id].tsx-1709-function ScheduleSkeleton() {
app/vehicle/[id].tsx-1710-  return (
app/vehicle/[id].tsx-1711-    <View style={styles.skeletonContainer}>
app/vehicle/[id].tsx-1712-      {[1, 2, 3, 4].map(i => (
--
app/(tabs)/home-tab.tsx-150-          <EmptyProperties />
app/(tabs)/home-tab.tsx-151-        ) : (
app/(tabs)/home-tab.tsx-152-          properties?.map((p, idx) => {
app/(tabs)/home-tab.tsx:153:            const isLocked = idx >= propertyLimit(profile);
app/(tabs)/home-tab.tsx-154-            const counts = taskCounts?.[p.id];
app/(tabs)/home-tab.tsx-155-            const overdue = counts?.overdue ?? 0;
app/(tabs)/home-tab.tsx-156-            const dueSoon = counts?.due_soon ?? 0;
app/(tabs)/home-tab.tsx-157-            const statusDotColor = overdue > 0 ? Colors.overdue : dueSoon > 0 ? Colors.dueSoon : null;
app/(tabs)/home-tab.tsx-158-            const icon = getPropertyIcon(p.property_type);
app/(tabs)/home-tab.tsx-159-            const label = getPropertyLabel(p);
app/(tabs)/home-tab.tsx-160-
app/(tabs)/home-tab.tsx-161-            const metaParts: string[] = [];
app/(tabs)/home-tab.tsx-162-            if (p.year_built) metaParts.push(`Built ${p.year_built}`);
app/(tabs)/home-tab.tsx-163-            if (p.square_footage) metaParts.push(`${p.square_footage.toLocaleString()} sqft`);
app/(tabs)/home-tab.tsx-164-            const typeLabel: Record<string, string> = {
app/(tabs)/home-tab.tsx-165-              house: "Single Family Home", condo: "Condo", apartment: "Apartment",
--
app/(tabs)/home-tab.tsx-175-                key={p.id}
app/(tabs)/home-tab.tsx-176-                style={({ pressed }) => [
app/(tabs)/home-tab.tsx-177-                  styles.propertyCard,
app/(tabs)/home-tab.tsx:178:                  { opacity: pressed ? 0.88 : isLocked ? 0.5 : 1 },
app/(tabs)/home-tab.tsx-179-                ]}
app/(tabs)/home-tab.tsx-180-                onPress={() => {
app/(tabs)/home-tab.tsx:181:                  if (isLocked) {
app/(tabs)/home-tab.tsx-182-                    setShowPaywall(true);
app/(tabs)/home-tab.tsx-183-                    return;
app/(tabs)/home-tab.tsx-184-                  }
app/(tabs)/home-tab.tsx-185-                  router.push(`/property/${p.id}` as any);
app/(tabs)/home-tab.tsx-186-                  Haptics.selectionAsync();
app/(tabs)/home-tab.tsx-187-                }}
app/(tabs)/home-tab.tsx-188-              >
app/(tabs)/home-tab.tsx-189-                <Ionicons name={icon as any} size={18} color={Colors.home} />
app/(tabs)/home-tab.tsx-190-
app/(tabs)/home-tab.tsx-191-                <View style={styles.cardInfo}>
app/(tabs)/home-tab.tsx-192-                  <View style={styles.cardTitleRow}>
app/(tabs)/home-tab.tsx-193-                    {statusDotColor && <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />}
--
app/(tabs)/home-tab.tsx-209-        <Paywall
app/(tabs)/home-tab.tsx-210-          canDismiss
app/(tabs)/home-tab.tsx-211-          showSkip={false}
app/(tabs)/home-tab.tsx:212:          subtitle="Adding more properties requires Pro."
app/(tabs)/home-tab.tsx-213-          onDismiss={() => setShowPaywall(false)}
app/(tabs)/home-tab.tsx-214-        />
app/(tabs)/home-tab.tsx-215-      </Modal>
app/(tabs)/home-tab.tsx-216-    </View>
app/(tabs)/home-tab.tsx-217-  );
app/(tabs)/home-tab.tsx-218-}
app/(tabs)/home-tab.tsx-219-
app/(tabs)/home-tab.tsx-220-function PropertyCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
app/(tabs)/home-tab.tsx-221-  return (
app/(tabs)/home-tab.tsx-222-    <View style={styles.propertyCard}>
app/(tabs)/home-tab.tsx-223-      <S anim={anim} w={36} h={36} r={10} />
app/(tabs)/home-tab.tsx-224-      <Col flex={1} gap={6}>
--
app/(tabs)/health.tsx-82-  const [toastMsg, setToastMsg] = useState("");
app/(tabs)/health.tsx-83-  const [toastVisible, setToastVisible] = useState(false);
app/(tabs)/health.tsx-84-  const [toastIsError, setToastIsError] = useState(false);
app/(tabs)/health.tsx:85:  const [paywallSubtitle, setPaywallSubtitle] = useState("Upgrade to unlock more family tracking.");
app/(tabs)/health.tsx-86-  const [showPaywall, setShowPaywall] = useState(false);
app/(tabs)/health.tsx-87-
app/(tabs)/health.tsx-88-  function showToast(msg: string, isError = false) {
app/(tabs)/health.tsx-89-    setToastMsg(msg);
app/(tabs)/health.tsx-90-    setToastIsError(isError);
app/(tabs)/health.tsx-91-    setToastVisible(true);
app/(tabs)/health.tsx-92-    setTimeout(() => setToastVisible(false), 2800);
app/(tabs)/health.tsx-93-  }
app/(tabs)/health.tsx-94-
app/(tabs)/health.tsx-95-  const { data: appointments, isLoading: loadingAppts, refetch: refetchAppts } = useQuery({
app/(tabs)/health.tsx-96-    queryKey: ["health_appointments", user?.id],
app/(tabs)/health.tsx-97-    queryFn: async () => {
--
app/(tabs)/health.tsx-419-    const currentPeople = familyMembers?.filter(fm => fm.member_type !== "pet").length ?? 0;
app/(tabs)/health.tsx-420-    const maxPeople = personLimit(profile);
app/(tabs)/health.tsx-421-    if (currentPeople >= maxPeople) {
app/(tabs)/health.tsx:422:      openPlanUpsell("Adding more people requires Pro.");
app/(tabs)/health.tsx-423-      return;
app/(tabs)/health.tsx-424-    }
app/(tabs)/health.tsx-425-    router.push("/add-family-member");
app/(tabs)/health.tsx-426-  }
app/(tabs)/health.tsx-427-
app/(tabs)/health.tsx-428-  function openAddPet() {
app/(tabs)/health.tsx-429-    const currentPets = familyMembers?.filter(fm => fm.member_type === "pet").length ?? 0;
app/(tabs)/health.tsx-430-    const maxPets = petLimit(profile);
app/(tabs)/health.tsx-431-    if (currentPets >= maxPets) {
app/(tabs)/health.tsx:432:      openPlanUpsell("Adding more pets requires Pro.");
app/(tabs)/health.tsx-433-      return;
app/(tabs)/health.tsx-434-    }
app/(tabs)/health.tsx-435-    router.push("/add-family-member?type=pet" as any);
app/(tabs)/health.tsx-436-  }
app/(tabs)/health.tsx-437-
app/(tabs)/health.tsx-438-  async function handleExportHealth() {
app/(tabs)/health.tsx-439-    if (!appointments?.length && !medications?.length) {
app/(tabs)/health.tsx-440-      Alert.alert("Nothing to Export", "Add some appointments or medications first.");
app/(tabs)/health.tsx-441-      return;
app/(tabs)/health.tsx-442-    }
app/(tabs)/health.tsx-443-    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
app/(tabs)/health.tsx-444-
--
app/(tabs)/health.tsx-602-                </Pressable>
app/(tabs)/health.tsx-603-                {profile?.subscription_tier === "free" && (
app/(tabs)/health.tsx-604-                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", marginTop: 8 }}>
app/(tabs)/health.tsx:605:                    Free plan includes limited tracking. Upgrade for more.
app/(tabs)/health.tsx-606-                  </Text>
app/(tabs)/health.tsx-607-                )}
app/(tabs)/health.tsx-608-              </View>
app/(tabs)/health.tsx-609-            ) : (
app/(tabs)/health.tsx-610-              <>
app/(tabs)/health.tsx-611-                {insightText && (
app/(tabs)/health.tsx-612-                  <View style={styles.insightCard}>
app/(tabs)/health.tsx-613-                    <Ionicons name="heart-outline" size={16} color={Colors.health} />
app/(tabs)/health.tsx-614-                    <Text style={styles.insightText}>{insightText}</Text>
app/(tabs)/health.tsx-615-                  </View>
app/(tabs)/health.tsx-616-                )}
app/(tabs)/health.tsx-617-
--
app/(tabs)/health.tsx-660-                    <View style={styles.memberGrid}>
app/(tabs)/health.tsx-661-                      {people.map((person, personIdx) => {
app/(tabs)/health.tsx-662-                        const maxPeople = personLimit(profile);
app/(tabs)/health.tsx:663:                        const isLocked = Number.isFinite(maxPeople) && personIdx >= maxPeople;
app/(tabs)/health.tsx-664-                        const status = apptStatusByMember[person.id] ?? { overdue: 0, upcoming: 0 };
app/(tabs)/health.tsx-665-                        return (
app/(tabs)/health.tsx-666-                          <View key={person.id} style={{ position: "relative" }}>
app/(tabs)/health.tsx:667:                            <View style={{ opacity: isLocked ? 0.5 : 1 }}>
app/(tabs)/health.tsx-668-                              <MemberCard
app/(tabs)/health.tsx-669-                                member={person}
app/(tabs)/health.tsx-670-                                overdue={status.overdue}
app/(tabs)/health.tsx-671-                                upcoming={status.upcoming}
app/(tabs)/health.tsx-672-                                onPress={() => { router.push(`/family-member/${person.id}` as any); Haptics.selectionAsync(); }}
app/(tabs)/health.tsx-673-                              />
app/(tabs)/health.tsx-674-                            </View>
app/(tabs)/health.tsx:675:                            {isLocked && (
app/(tabs)/health.tsx-676-                              <Pressable
app/(tabs)/health.tsx-677-                                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
app/(tabs)/health.tsx:678:                                onPress={() => openPlanUpsell("Accessing more family members requires Pro.")}
app/(tabs)/health.tsx-679-                              />
app/(tabs)/health.tsx-680-                            )}
app/(tabs)/health.tsx-681-                          </View>
app/(tabs)/health.tsx-682-                        );
app/(tabs)/health.tsx-683-                      })}
app/(tabs)/health.tsx-684-                    </View>
app/(tabs)/health.tsx-685-                  </SectionBlock>
app/(tabs)/health.tsx-686-                )}
app/(tabs)/health.tsx-687-
app/(tabs)/health.tsx-688-                {pets.length > 0 && (
app/(tabs)/health.tsx-689-                  <SectionBlock
app/(tabs)/health.tsx-690-                    title="Pets"
--
app/(tabs)/health.tsx-693-                    <View style={styles.memberGrid}>
app/(tabs)/health.tsx-694-                      {pets.map((pet, petIdx) => {
app/(tabs)/health.tsx-695-                        const maxPets = petLimit(profile);
app/(tabs)/health.tsx:696:                        const isLocked = Number.isFinite(maxPets) && petIdx >= maxPets;
app/(tabs)/health.tsx-697-                        const status = apptStatusByMember[pet.id] ?? { overdue: 0, upcoming: 0 };
app/(tabs)/health.tsx-698-                        return (
app/(tabs)/health.tsx-699-                          <View key={pet.id} style={{ position: "relative" }}>
app/(tabs)/health.tsx:700:                            <View style={{ opacity: isLocked ? 0.5 : 1 }}>
app/(tabs)/health.tsx-701-                              <MemberCard
app/(tabs)/health.tsx-702-                                member={pet}
app/(tabs)/health.tsx-703-                                overdue={status.overdue}
app/(tabs)/health.tsx-704-                                upcoming={status.upcoming}
app/(tabs)/health.tsx-705-                                onPress={() => { router.push(`/family-member/${pet.id}` as any); Haptics.selectionAsync(); }}
app/(tabs)/health.tsx-706-                              />
app/(tabs)/health.tsx-707-                            </View>
app/(tabs)/health.tsx:708:                            {isLocked && (
app/(tabs)/health.tsx-709-                              <Pressable
app/(tabs)/health.tsx-710-                                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
app/(tabs)/health.tsx:711:                                onPress={() => openPlanUpsell("Accessing more pets requires Pro.")}
app/(tabs)/health.tsx-712-                              />
app/(tabs)/health.tsx-713-                            )}
app/(tabs)/health.tsx-714-                          </View>
app/(tabs)/health.tsx-715-                        );
app/(tabs)/health.tsx-716-                      })}
app/(tabs)/health.tsx-717-                    </View>
app/(tabs)/health.tsx-718-                  </SectionBlock>
app/(tabs)/health.tsx-719-                )}
app/(tabs)/health.tsx-720-
app/(tabs)/health.tsx-721-                {medications && medications.length > 0 && (
app/(tabs)/health.tsx-722-                  <SectionBlock
app/(tabs)/health.tsx-723-                    title="Medication Tracker"
--
app/(tabs)/vehicles.tsx-165-          <EmptyVehicles />
app/(tabs)/vehicles.tsx-166-        ) : (
app/(tabs)/vehicles.tsx-167-          vehicles?.map((v, idx) => {
app/(tabs)/vehicles.tsx:168:            const isLocked = idx >= vehicleLimit(profile);
app/(tabs)/vehicles.tsx-169-            const td = taskData?.[v.id];
app/(tabs)/vehicles.tsx-170-            const worstStatus = td?.worstStatus ?? "good";
app/(tabs)/vehicles.tsx-171-            const icon = getVehicleIcon(v.vehicle_type);
app/(tabs)/vehicles.tsx-172-            const title = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
app/(tabs)/vehicles.tsx-173-            const displayName = v.nickname ?? title;
app/(tabs)/vehicles.tsx-174-
app/(tabs)/vehicles.tsx-175-            const mode = resolveTrackingMode(v);
app/(tabs)/vehicles.tsx-176-            const tracksMiles = isMileageTracked(v);
app/(tabs)/vehicles.tsx-177-            const tracksHrs = isHoursTracked(v);
app/(tabs)/vehicles.tsx-178-            const daysSinceUpdate = v.updated_at ? differenceInDays(new Date(), parseISO(v.updated_at)) : null;
app/(tabs)/vehicles.tsx-179-            const isStale = daysSinceUpdate != null && daysSinceUpdate >= 7;
app/(tabs)/vehicles.tsx-180-
--
app/(tabs)/vehicles.tsx-224-            return (
app/(tabs)/vehicles.tsx-225-              <Pressable
app/(tabs)/vehicles.tsx-226-                key={v.id}
app/(tabs)/vehicles.tsx:227:                style={({ pressed }) => [styles.vehicleCard, { opacity: pressed ? 0.88 : isLocked ? 0.55 : 1 }]}
app/(tabs)/vehicles.tsx-228-                onPress={() => {
app/(tabs)/vehicles.tsx:229:                  if (isLocked) {
app/(tabs)/vehicles.tsx-230-                    setShowPaywall(true);
app/(tabs)/vehicles.tsx-231-                    return;
app/(tabs)/vehicles.tsx-232-                  }
app/(tabs)/vehicles.tsx-233-                  router.push(`/vehicle/${v.id}` as any);
app/(tabs)/vehicles.tsx-234-                  Haptics.selectionAsync();
app/(tabs)/vehicles.tsx-235-                }}
app/(tabs)/vehicles.tsx-236-              >
app/(tabs)/vehicles.tsx-237-                {v.photo_url ? (
app/(tabs)/vehicles.tsx-238-                  <Image source={{ uri: v.photo_url }} style={{ width: 36, height: 36, borderRadius: 10 }} resizeMode="cover" />
app/(tabs)/vehicles.tsx-239-                ) : (
app/(tabs)/vehicles.tsx-240-                  <Ionicons name={icon as any} size={18} color={Colors.vehicle} />
app/(tabs)/vehicles.tsx-241-                )}
--
app/(tabs)/vehicles.tsx-257-                      {metaLine}
app/(tabs)/vehicles.tsx-258-                    </Text>
app/(tabs)/vehicles.tsx-259-                  ) : null}
app/(tabs)/vehicles.tsx:260:                  {isLocked && (
app/(tabs)/vehicles.tsx:261:                    <View style={styles.lockedRow}>
app/(tabs)/vehicles.tsx-262-                      <Ionicons name="lock-closed" size={11} color={Colors.textTertiary} />
app/(tabs)/vehicles.tsx:263:                      <Text style={styles.lockedText}>Upgrade to access</Text>
app/(tabs)/vehicles.tsx-264-                    </View>
app/(tabs)/vehicles.tsx-265-                  )}
app/(tabs)/vehicles.tsx-266-                </View>
app/(tabs)/vehicles.tsx-267-                <View style={styles.cardRight}>
app/(tabs)/vehicles.tsx-268-                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
app/(tabs)/vehicles.tsx-269-                </View>
app/(tabs)/vehicles.tsx-270-              </Pressable>
app/(tabs)/vehicles.tsx-271-            );
app/(tabs)/vehicles.tsx-272-          })
app/(tabs)/vehicles.tsx-273-        )}
app/(tabs)/vehicles.tsx-274-      </ScrollView>
app/(tabs)/vehicles.tsx-275-
--
app/(tabs)/vehicles.tsx-277-        <Paywall
app/(tabs)/vehicles.tsx-278-          canDismiss
app/(tabs)/vehicles.tsx-279-          showSkip={false}
app/(tabs)/vehicles.tsx:280:          subtitle="Adding more vehicles requires Pro."
app/(tabs)/vehicles.tsx-281-          onDismiss={() => setShowPaywall(false)}
app/(tabs)/vehicles.tsx-282-        />
app/(tabs)/vehicles.tsx-283-      </Modal>
app/(tabs)/vehicles.tsx-284-    </View>
app/(tabs)/vehicles.tsx-285-  );
app/(tabs)/vehicles.tsx-286-}
app/(tabs)/vehicles.tsx-287-
app/(tabs)/vehicles.tsx-288-function VehicleCardSkeleton({ anim }: { anim: ReturnType<typeof usePulse> }) {
app/(tabs)/vehicles.tsx-289-  return (
app/(tabs)/vehicles.tsx-290-    <View style={styles.vehicleCard}>
app/(tabs)/vehicles.tsx-291-      <S anim={anim} w={36} h={36} r={10} />
app/(tabs)/vehicles.tsx-292-      <Col flex={1} gap={5}>
--
app/(tabs)/vehicles.tsx-354-  vehicleMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
app/(tabs)/vehicles.tsx-355-  cardRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
app/(tabs)/vehicles.tsx-356-  statusDot: { width: 8, height: 8, borderRadius: 4 },
app/(tabs)/vehicles.tsx:357:  lockedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
app/(tabs)/vehicles.tsx:358:  lockedText: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
app/(tabs)/vehicles.tsx-359-
app/(tabs)/vehicles.tsx-360-  emptyWrap: { flex: 1, paddingTop: 60, alignItems: "center", gap: 10 },
app/(tabs)/vehicles.tsx-361-  emptyTitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
app/(tabs)/vehicles.tsx-362-  emptyLink: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.accent },
app/(tabs)/vehicles.tsx-363-});
--
app/(tabs)/settings.tsx-423-  const trialDaysLeft = profile?.trial_expires_at
app/(tabs)/settings.tsx-424-    ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
app/(tabs)/settings.tsx-425-    : 0;
app/(tabs)/settings.tsx:426:  const isPremium = hasPersonalOrAbove(profile);
app/(tabs)/settings.tsx:427:  const userIsFreeTier = !userIsInTrial && !isPremium;
app/(tabs)/settings.tsx-428-  const tierLabel = userIsInTrial ? "Trial" : hasBusiness(profile) ? "Business" : hasProOrAbove(profile) ? "Pro" : hasPersonalOrAbove(profile) ? "Personal" : "Free";
app/(tabs)/settings.tsx-429-  const expiryDate = profile?.subscription_expires_at ? parseISO(profile.subscription_expires_at) : null;
app/(tabs)/settings.tsx-430-  const isLifetime = expiryDate != null && expiryDate.getFullYear() - new Date().getFullYear() > 50;
app/(tabs)/settings.tsx-431-  const tierExpiry = expiryDate && !isLifetime ? format(expiryDate, "MMMM d, yyyy") : null;
app/(tabs)/settings.tsx-432-  const tierExpiryLabel = isLifetime
app/(tabs)/settings.tsx-433-    ? "Lifetime"
app/(tabs)/settings.tsx-434-    : tierExpiry
app/(tabs)/settings.tsx-435-      ? (expiryDate! > new Date() ? `Renews ${tierExpiry}` : `Expires ${tierExpiry}`)
app/(tabs)/settings.tsx-436-      : "Active subscription";
app/(tabs)/settings.tsx-437-
app/(tabs)/settings.tsx-438-  if (!isLoaded) {
app/(tabs)/settings.tsx-439-    return (
--
app/(tabs)/settings.tsx-469-                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
app/(tabs)/settings.tsx-470-                onPress={() => router.push("/subscription" as any)}
app/(tabs)/settings.tsx-471-              >
app/(tabs)/settings.tsx:472:                <Text style={styles.bannerBtnText}>Upgrade</Text>
app/(tabs)/settings.tsx-473-              </Pressable>
app/(tabs)/settings.tsx-474-            </View>
app/(tabs)/settings.tsx-475-          )}
app/(tabs)/settings.tsx-476-
app/(tabs)/settings.tsx-477-          {userIsFreeTier && !userIsInTrial && (
app/(tabs)/settings.tsx-478-            <View style={styles.banner}>
app/(tabs)/settings.tsx-479-              <View style={styles.bannerText}>
app/(tabs)/settings.tsx-480-                <Text style={styles.bannerTitle}>Free Plan</Text>
app/(tabs)/settings.tsx:481:                <Text style={styles.bannerSub}>Upgrade to unlock vehicles, scans & exports</Text>
app/(tabs)/settings.tsx-482-              </View>
app/(tabs)/settings.tsx-483-              <Pressable
app/(tabs)/settings.tsx-484-                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
app/(tabs)/settings.tsx-485-                onPress={() => router.push("/subscription" as any)}
app/(tabs)/settings.tsx-486-              >
app/(tabs)/settings.tsx:487:                <Text style={styles.bannerBtnText}>Upgrade</Text>
app/(tabs)/settings.tsx-488-              </Pressable>
app/(tabs)/settings.tsx-489-            </View>
app/(tabs)/settings.tsx-490-          )}
app/(tabs)/settings.tsx-491-
app/(tabs)/settings.tsx:492:          {isPremium && !userIsInTrial && (
app/(tabs)/settings.tsx-493-            <View style={styles.banner}>
app/(tabs)/settings.tsx-494-              <View style={styles.bannerText}>
app/(tabs)/settings.tsx-495-                <Text style={styles.bannerTitle}>{tierLabel} Plan</Text>
app/(tabs)/settings.tsx-496-                <Text style={styles.bannerSub}>{tierExpiryLabel}</Text>
app/(tabs)/settings.tsx-497-              </View>
app/(tabs)/settings.tsx-498-            </View>
app/(tabs)/settings.tsx-499-          )}
app/(tabs)/settings.tsx-500-
app/(tabs)/settings.tsx-501-          {/* ACCOUNT */}
app/(tabs)/settings.tsx-502-          <Text style={styles.sectionLabel}>Account</Text>
app/(tabs)/settings.tsx-503-          <View style={styles.groupCard}>
app/(tabs)/settings.tsx-504-            <View style={styles.accountEmailRow}>
--
app/(tabs)/settings.tsx-723-            >
app/(tabs)/settings.tsx-724-              <Text style={styles.legalBtnText}>Privacy Policy</Text>
app/(tabs)/settings.tsx-725-            </Pressable>
app/(tabs)/settings.tsx:726:            {isPremium && !userIsInTrial && !!profile?.revenuecat_customer_id && (
app/(tabs)/settings.tsx-727-              <>
app/(tabs)/settings.tsx-728-                <Text style={styles.legalDot}>·</Text>
app/(tabs)/settings.tsx-729-                <Pressable
app/(tabs)/settings.tsx-730-                  style={({ pressed }) => [styles.legalBtn, { opacity: pressed ? 0.7 : 1 }]}
app/(tabs)/settings.tsx-731-                  onPress={() => {
app/(tabs)/settings.tsx-732-                    const { Linking } = require("react-native");
app/(tabs)/settings.tsx-733-                    Linking.openURL("itms-apps://apps.apple.com/account/subscriptions");
app/(tabs)/settings.tsx-734-                  }}
app/(tabs)/settings.tsx-735-                >
app/(tabs)/settings.tsx-736-                  <Text style={styles.legalBtnText}>Manage Subscription</Text>
app/(tabs)/settings.tsx-737-                </Pressable>
app/(tabs)/settings.tsx-738-              </>
```

---

## Findings

### PASS-D-001 — ReceiptScanButton runs full image pick + AI roundtrip before discovering the paid user is at cap

**Severity:** LAUNCH-BLOCKER
**Pattern:** A
**Location:** `components/ReceiptScanButton.tsx:40-102`, called from `app/log-service/[vehicleId].tsx:465-471` with `onPaidUserAtCap={() => setShowScanPackModal(true)}`. Source of truth for cap: server response in `lib/receiptScanner.ts:62-103` (`scans_used`/`scans_limit` from `scan-receipt`).
**Evidence:** `ReceiptScanButton.tsx:53-55` launches the camera/library, `:61` flips `setScanning(true)`, `:63-67` runs `ImageManipulator.manipulateAsync` (resize + JPEG), `:73` invokes `scanReceipt` (Edge Function `scan-receipt`), and only at `:77-85` does the cap branch fire (`isScanLimit` → `onPaidUserAtCap()`). `lib/subscription.ts:130-133` exposes a usable `scansRemaining(profile)` helper that is never read by the button.
**What's there today:** A paid user taps "Scan Receipt", picks Camera or Library, takes/picks a photo, waits through manipulation + base64 + edge-function roundtrip (typically 5–15s on cellular, longer on poor connectivity), then sees ScanPackModal pop up telling them they're out of scans. The free-tier branch in `app/log-service/[vehicleId].tsx:449-463` correctly substitutes a locked "Upgrade" button — paid users do not get that pre-check.
**Why it matters:** This is the textbook "user does meaningful work before being told no" pattern. A paid user who has paid for an upsell (scan packs) experiences the most-degraded version of the flow — wait, then "buy more." Even if they buy the pack, the photo they already picked is discarded. This is the highest-friction monetization moment in the app and currently treats paying users worse than free users.
**Failure mode:** Paid Pro user in a parking lot snaps a $84 receipt, watches a 12-second spinner on LTE, then gets a "you're out of scans" sheet with two SKUs and no context that the photo they just took will be lost. They cancel, retype manually, and don't trust the scan flow next time.
**Fix direction:** Read `scansRemaining(profile)` (already in `lib/subscription.ts`) at the entry of `handleScan`/`showOptions` in `ReceiptScanButton.tsx`. If `<= 0`, route to the appropriate sheet (free → Paywall via `onScanLimitReached`; paid → ScanPackModal via `onPaidUserAtCap`) BEFORE calling `ImagePicker.launchCameraAsync` / `launchImageLibraryAsync`. Keep the server-side `scan_limit` branch as a defence-in-depth fallback (handles racey state + `monthly_scan_count` lag), but it should be the rare path, not the primary path. State owner stays where it is (caller's `setShowScanPackModal` / `setShowPaywall`); ReceiptScanButton just needs `profile` (or a derived `scansRemaining` prop) injected.
**Group 7 readiness:** READY

### PASS-D-002 — Add Vehicle FAB pushes user through the entire add-vehicle form before paywalling at submit

**Severity:** PRE-LAUNCH
**Pattern:** A
**Location:** Entry: `app/(tabs)/vehicles.tsx:138-141` (FAB) and `app/(tabs)/vehicles.tsx:317` (empty-state CTA). Late gate: `app/add-vehicle.tsx:970-980`. Helper available: `vehicleLimit(profile)` from `lib/subscription.ts`.
**Evidence:** vehicles.tsx FAB `onPress` is just `router.push("/add-vehicle")` with no count/limit check. The form-level gate at `add-vehicle.tsx:972-980` runs a `select count(*) from vehicles` then `setShowPaywall(true)` after the user has filled out year/make/model/mileage/tracking-mode/trim/etc.
**What's there today:** A capped free-tier user lands on Vehicles, taps the prominent orange "+ Vehicle" FAB, walks through year selectors, NHTSA make/model fetches, mileage entry, then taps Save and only then sees the Paywall with subtitle "Upgrade to add more vehicles."
**Why it matters:** Form abandonment after wasted effort is well-documented to lower conversion vs. an upfront upsell. The user already knows they want a second vehicle — paywall them at intent, not at submit. Locked-card taps already do this correctly (`vehicles.tsx:229-232`), so the inconsistency is doubly visible.
**Failure mode:** Free-tier user adds first vehicle in onboarding, comes back two weeks later wanting to track the family car, fills in 8 fields, taps Save, sees "Adding more vehicles requires Pro." The form state survives the modal, but the user's perception is "they let me do all that work just to upsell me at the end."
**Fix direction:** Wrap the FAB and empty-state press handlers in `vehicles.tsx` with a count check (`vehicles?.length ?? 0 >= vehicleLimit(profile)` → `setShowPaywall(true)`). Keep the form-submit gate at `add-vehicle.tsx:976` as a defensive failsafe. The vehicles tab already owns `showPaywall` state and the Paywall Modal, so no new state needed.
**Group 7 readiness:** READY

### PASS-D-003 — Add Property FAB has the same late-gate pattern as Add Vehicle

**Severity:** PRE-LAUNCH
**Pattern:** A
**Location:** Entry: `app/(tabs)/home-tab.tsx:130-133`. Late gate: `app/add-property.tsx:276-283`. Helper available: `propertyLimit(profile)`.
**Evidence:** home-tab FAB `onPress` calls `router.push("/add-property")` directly. Locked existing-property cards at `home-tab.tsx:181-184` correctly pre-gate. The form path at `add-property.tsx:276-283` does an existence count then `setShowPaywall(true)` after the user has hit Save.
**What's there today:** Identical pattern to PASS-D-002 but on the home/properties tab. The user can additionally have done a Google Places autocomplete (line 95) and a property-lookup edge-function call (line 238) before the gate fires — meaning two billable AI invocations may have already run server-side for a user who can't save the property.
**Why it matters:** Same conversion argument as PASS-D-002, plus the cost of the wasted Places/property-lookup edge-function calls. Inconsistent with the pre-gated locked-card flow on the same screen.
**Failure mode:** Free user adds rental property after first home, types address, watches autocomplete, picks suggestion, waits for property-lookup hydration, taps Save, gets paywalled. Same "they wasted my time" perception.
**Fix direction:** Pre-gate the FAB in `home-tab.tsx:130-133` against `propertyLimit(profile)`. Keep the submit-time gate as failsafe. Set the existing `showPaywall` state on home-tab.tsx (already wired at line 76) directly from the FAB.
**Group 7 readiness:** READY

### PASS-D-004 — Voice / LogSheet flow has no tier gate; the only quota is local AsyncStorage and fires after recording stops

**Severity:** PRE-LAUNCH
**Pattern:** A
**Location:** `components/LogSheet.tsx:501-530` (start recording), `:532-551` (stop), `:553-590` (transcribe), `:1142-1165` (local quota helpers).
**Evidence:** `handleStartRecording` does `Audio.requestPermissionsAsync` + `rec.startAsync()` with no tier or quota check at the click site. The only limiter is `checkVoiceTranscriptionLimit()` at line 559, called inside `handleTranscribe` AFTER recording has stopped. Limit constant: `MAX_DAILY_VOICE_TRANSCRIPTIONS = 30` enforced in AsyncStorage only — no server enforcement, no tier coupling. Paywall.tsx feature lists at lines 49, 66, 82 advertise "Voice logging" as a paid feature, but the code lets free users use it freely.
**What's there today:** Free, trial, and paid users all get up to 30 voice transcriptions/day with no differentiation. Hitting the local cap (only after recording + stop) shows an inline error and routes to manual typing.
**Why it matters:** Two issues. (1) Pricing inconsistency: "Voice logging" is sold as a Personal+ feature on the Paywall but free users are not gated. Either the marketing is wrong or the gate is missing. (2) Even the local quota fires after the user has spent recording effort, so a heavy day produces wasted-effort failures rather than upfront "buy more / upgrade" prompts.
**Failure mode:** A free-tier user uses voice logging extensively and never gets nudged to upgrade — Paywall promises something they already have. Or, on day 31 of recordings, the user records a 90-second monologue, hits stop, sees "Daily voice transcription limit reached. Try again tomorrow." with no upgrade path offered.
**Fix direction:** Decide product call first: is voice paid or free? If paid: add `requirePaidTier` check at `handleStartRecording` entry (before `Audio.requestPermissionsAsync` if you want pure UX, or before `rec.startAsync` to keep mic permissions request transactional). If free with daily abuse cap: keep current limit but move the check to before recording starts (read AsyncStorage in the orb-tap handler). Either way, surface the cap reaching as an upgrade/upsell moment, not a dead-end "try tomorrow." Update Paywall feature lines to match the chosen model.
**Group 7 readiness:** NEEDS FRESH SOURCE PULL — depends on a product call about voice tier coupling that should be made before code changes; once decided, the implementation is small.

### PASS-D-005 — Repair-cost estimate (`estimate-repair-cost`) auto-fires for every user with no gate

**Severity:** POST-LAUNCH
**Pattern:** A
**Location:** `app/vehicle/[id].tsx:222-258` (the `useQuery` that batches `supabase.functions.invoke("estimate-repair-cost", ...)`), enabled by `:257: enabled: !!vehicle?.make && !!scheduleTasks?.length`.
**Evidence:** No tier read, no profile gate. The query is auto-enabled the moment a vehicle has a make and a schedule. There's a 1-hour staleTime + a `repair_cost_cache` table read first, but cache misses do invoke the edge function freely. The Paywall does not advertise repair-cost estimates as a tier feature in `components/Paywall.tsx:45-86`.
**What's there today:** Every user — free, trial, premium — gets unlimited cached + on-demand repair-cost AI estimates whenever they open a vehicle detail page.
**Why it matters:** This is by design as a value-reveal feature for free users (drives engagement, surfaces the schedule's premium feel). But because it's not in any Paywall feature list, free users won't perceive it as a paid benefit. If costs become a concern (they're billable AI calls scaled by user count and schedule length), the easiest lever is to gate cache-miss calls — but doing that without designing the surface right would be a regression.
**Failure mode:** Server-side AI cost on free users grows linearly with vehicle count × schedule length. If margins compress, no client-side knob exists to throttle.
**Fix direction:** Treat as deferred. If product wants to gate later, add a `hasActivePremium(profile)` check around the uncached batch in the `useQuery` at `vehicle/[id].tsx:222-253`, falling back to "Pro tip: subscribe to see live cost ranges" inline when missing. No other change needed.
**Group 7 readiness:** READY (but defer; not a launch issue).

### PASS-D-006 — Onboarding building-plan AI generation runs free for first vehicle and that's the right call

**Severity:** POST-LAUNCH
**Pattern:** A
**Location:** `app/(onboarding)/building-plan.tsx:128-170` invokes `generate-maintenance-schedule` for the user's first vehicle inside the onboarding flow with no tier check.
**Evidence:** No `subscription_tier` read. The same edge function is invoked again from `app/add-vehicle.tsx:1077` and `:1135` (subsequent vehicle adds) and `app/vehicle/[id].tsx:477,518` (re-generate flows), also without tier checks.
**What's there today:** Free user signs up, adds first vehicle, sees a wizard-grade plan-generation animation, gets the schedule. That moment is the value-reveal the entire onboarding is built around.
**Why it matters:** This is intentional and correct — the value reveal is the conversion mechanism. Gating it would torpedo the funnel. But: the same code path is also used for vehicles 2..N and for re-generation, where free-tier users are already capped at 1 vehicle (`vehicleLimit(profile)`). So in practice there's no monetization leak — they can't reach add-vehicle path 2 without paywalling first. No-issue, documented for completeness.
**Failure mode:** None today. Future risk: if vehicleLimit free-tier is ever raised or the trial is restructured, edge-function spend on schedule generation could grow.
**Fix direction:** None. Document the rule "first-vehicle generation is intentionally ungated; subsequent generation is implicitly gated by `vehicleLimit`" in a one-line comment near `building-plan.tsx:128` if it helps future maintainers.
**Group 7 readiness:** READY (no action) — finding intentionally produced because the audit task list requires per-topic coverage even when conclusion is "no issue."

### PASS-D-007 — ScanPackModal pack hierarchy is flat and the "Save 40%" math is misleading

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `components/ScanPackModal.tsx:27-30` (PACK config), `:135-167` (card render), `:236-245` (badge style).
**Evidence:** Both packs use `Ionicons name="receipt-outline" size={20}` (line 155). Both use the same `packCard` style; the popular variant only swaps a tint (line 232-235) and tints the title/price (line 156, 162). The "Save 40%" badge is hardcoded text (line 151) — actual math is $2.99/10 = $0.299/scan vs $4.99/25 = $0.200/scan, which is a 33% per-scan saving, not 40%. There is no per-scan price displayed anywhere on the cards.
**What's there today:** Two near-identical cards differentiated by a small accent tint and a small "Save 40%" badge. The user has to mentally divide $4.99/25 vs $2.99/10 to see the unit economics. The label asserts a savings number that doesn't reconcile to either the per-scan or total-spend math.
**Why it matters:** A purchase decision sheet is supposed to make the recommended option visually obvious and the math defensible. Right now the design under-sells the better option AND makes a savings claim that won't survive scrutiny if a customer-support thread or an App Store reviewer crosses-multiplies. Premium-feel paid surfaces don't do this.
**Failure mode:** A user weighing the two packs picks the cheaper one because the "Save 40%" claim feels like marketing copy without proof. Worse: a Reddit or Twitter post does the math and frames the app as deceptively priced.
**Fix direction:** Compute per-scan price in code (`(parseFloat(pack.price.slice(1)) / pack.scans).toFixed(2)`) and render it as a secondary line under each pack title ("$0.30/scan" vs "$0.20/scan"). Replace "Save 40%" with the actually-true claim ("Save 33%") OR redesign the badge as a checkmark/gem badge whose claim is "Best Value" not a percentage. Differentiate the popular pack with a larger icon (e.g., a stack icon, or a 28-32px receipt icon vs 20px), a heavier weight title, and a deeper accent fill — the goal is "your eye lands on the 25-pack first."
**Group 7 readiness:** READY

### PASS-D-008 — ScanPackModal is a Modal pretending to be a bottom sheet — drag handle without gesture, plus interaction-model gaps

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `components/ScanPackModal.tsx:107-178` (the Modal), `:115-117` (decorative handle), `:114` (tap-overlay-to-dismiss), `:169-174` (Cancel button), `:135-167` (cards during purchase).
**Evidence:** Uses RN's `<Modal transparent animationType="slide">` with a manually styled bottom sheet. The 36×4 "handle" at line 116 has no `PanResponder` / `Gesture` wiring — it is purely decorative. No `@gorhom/bottom-sheet` import anywhere in the project (verified by grep — see B5). The Cancel button at `:169-174` is rendered BELOW the pack cards and is NOT disabled while a purchase is in flight (`disabled={purchasingId !== null}` is only on the pack `Pressable` at :146, not on Cancel at :169-174). During purchase, only the spinning card swaps its price for an `ActivityIndicator`; the rest of the sheet stays interactive.
**What's there today:** A sheet that looks like an iOS bottom sheet (rounded top, drag handle) but cannot be swiped down, with a Cancel button beneath the pack options that can be tapped during a StoreKit purchase, potentially leaving the purchase orphan.
**Why it matters:** Apple HIG calls this out specifically — affordances must match behavior or users feel the app is fake/cheap. A drag handle implies a swipe-down gesture; users will try it and feel the sheet is broken. The Cancel-during-purchase race is a real risk — `Purchases.purchaseProduct` can succeed at StoreKit while the modal is closing, producing a credited charge but a dismissed sheet (the success toast at line 89-92 is queued via setTimeout against state that may already be unmounted).
**Failure mode:** User tries to swipe down to dismiss, nothing happens, taps the dim background, sheet dismisses. Or: user starts a purchase, sees Apple's StoreKit dialog, dismisses the StoreKit dialog (Apple animates back to the app), in that brief window taps Cancel because they think the purchase was canceled — but it wasn't. They are charged. SaveToast fires after dismissal and is hidden by parent unmount.
**Fix direction:** Two options. (Light) Disable the Cancel button while `purchasingId !== null`, dim it, and remove the decorative drag handle (or scale it down to a non-affordance line). (Better) Migrate to `@gorhom/bottom-sheet` with proper gesture handling and a single `enableDismissOnClose={!purchasing}` lock. The "better" path is appropriate if Group 7 is also touching Paywall presentation; otherwise the light fix is sufficient for launch. Either way, mount the success-toast logic on the parent (`log-service`) so dismissal during success doesn't drop the confirmation.
**Group 7 readiness:** READY

### PASS-D-009 — ScanPackModal is only reachable as a server-side late-gate response; paid users can't proactively top up

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** Only entry: `app/log-service/[vehicleId].tsx:701-705`, triggered by `ReceiptScanButton`'s `onPaidUserAtCap` at `:470` — which fires only after the `scan-receipt` edge function returns a scan-limit error (PASS-D-001).
**Evidence:** Project-wide grep (`rg ScanPackModal app/ components/`) finds zero proactive entry points. There is no Settings row, no Paywall CTA, no profile screen surface that lets a paid user buy scans before they hit the cap. There is no UI display anywhere of `scan_credits` balance or `monthly_scan_count` remaining.
**What's there today:** A paid user cannot buy more scans except by failing into the limit. Power users (e.g., property managers logging 30+ receipts in a day during tax season) cannot top up in advance.
**Why it matters:** Two-tier monetization — subscriptions plus consumable packs — only works if the consumable is discoverable and frictionless. If the only path is "fail, then buy," packs are positioned as a recovery tax instead of a power-user enhancement, and revenue is left on the table.
**Failure mode:** Pro user knows they have 4 scans left and 12 receipts to enter. They have no way to buy ahead of time, so they either ration their scans (bad UX), wait until they fail and buy reactively (bad UX), or skip the AI entirely (lost feature engagement).
**Fix direction:** Add a "Scans" row to Settings (between Account and Notifications) that shows `scansRemaining(profile)` and a "Buy more" CTA opening ScanPackModal. Optionally add a small inline CTA in the Paywall's "AI scan limits" box at `Paywall.tsx:596-602` for paid users. ScanPackModal already takes only `visible/onClose/onSuccess` props, so it can be hosted from any screen.
**Group 7 readiness:** READY

### PASS-D-010 — Paywall tier cards are visually flat; "Most Popular" is a 11px line of text and configured icons are dead

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `components/Paywall.tsx:26-87` (TIER_CONFIG), `:548-594` (tier card render), `:553-555` ("Most Popular" label), `:789-820` (styles).
**Evidence:** Every tier renders the same `tierCard` structure: tier name (line 566), price (line 569), price-sub (line 573), radio (line 576-581), feature list (line 583-590). The popular tier's only visual differentiator is `<Text style={styles.popularLabel}>Most Popular</Text>` at line 554 (style: fontSize 11, color = tier color, no background, line 791-794) — there is no scaled card, no shadow, no badge, no icon emphasis. TIER_CONFIG defines `icon: keyof typeof Ionicons.glyphMap` per tier (lines 39, 55, 72) — `person`, `briefcase`, `business` — but the icons are NEVER rendered anywhere in the component (no `<Ionicons name={cfg.icon} ...>` in the tier render).
**What's there today:** Three identical-looking cards stacked vertically; the recommended tier is signaled by an inconspicuous accent-colored caption above the card that's smaller than the price. The user's eye has nowhere to land first.
**Why it matters:** This is the central conversion surface. Without visual hierarchy, users default to the cheapest option (or scroll past), and the "most popular" hint exerts no behavioural pull. The unused icon config also means a small style-pass investment was already started and abandoned.
**Failure mode:** Cohort A/B comparison: the "most popular" line moves Pro selection by single digits because users don't see it as a recommendation, just as a label. Personal selection dominates, ARPU stays low.
**Fix direction:** (1) Render the configured `cfg.icon` in the tier card top-row (`Paywall.tsx:564`), 22-24px, color = `cfg.color`, with the existing tinted background pattern. (2) Add a real "Most Popular" badge component (pill, accent fill, white text, top-right of the popular card, slightly inset), replacing the floating caption at line 553-555. (3) Scale the popular card slightly (e.g., +4px padding, deeper shadow on iOS, slightly heavier border) — design specifics belong to design, but the structure should accept it. (4) Optional: render selected radio inside a colored chip rather than 20×20 outline.
**Group 7 readiness:** READY

### PASS-D-011 — Paywall doesn't use the call-site context it already receives — every entry collapses to one generic tier list

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `components/Paywall.tsx:97-103` (props), `:478-496` (header rendering subtitle). Call sites: `app/(tabs)/vehicles.tsx:280`, `app/(tabs)/home-tab.tsx:212`, `app/(tabs)/health.tsx:771-778` (uses dynamic `paywallSubtitle`), `app/vehicle/[id].tsx:1700`, `app/log-service/[vehicleId].tsx:696`, `app/add-vehicle.tsx:2174`, `app/add-property.tsx:578`, `app/add-family-member.tsx:206`, `app/subscription.tsx:5-12`.
**Evidence:** Paywall accepts a single `subtitle?: string` prop. Every call site passes a vertical-specific string ("Adding more vehicles requires Pro.", "Upgrade to scan receipts with AI", "Adding more people requires Pro.", etc.) — but the Paywall body is identical regardless. Tier cards use `cfg.color` (Personal=accent orange, Pro=`Colors.vehicle` blue, Business=`Colors.health` green) — these are tier identifiers, NOT the caller's vertical accent. There is no logic anywhere to pre-select a tier based on which limit was hit, no logic to reorder/highlight relevant features, no logic to render a vertical hero icon.
**What's there today:** A user upsold from health tab sees the same Paywall as a user upsold from vehicles, with only the subtitle text differing. The "6 vehicles + 5 properties" line on the Pro card sits in plain text alongside "5 people + 3 pets" with no emphasis on whichever line drove the upsell.
**Why it matters:** Context-blind paywalls underperform context-aware ones because the user has to mentally re-identify why they're here. When the user came from "Add 6th vehicle," the most relevant fact is the vehicle line on the Pro card — it should be highlighted. When they came from "Scan receipt," the AI scan-limits box (`:596-602`) is the relevant frame, but it's buried beneath all three tier cards. Premium paid surfaces lead with the user's reason, not a generic feature list.
**Failure mode:** User from vehicles cap upgrades to Personal (3 vehicles + 2 properties) because the price is lower, then immediately hits the same cap because Personal's vehicle limit is 3, not 6. They feel tricked or confused and either churn or charge back.
**Fix direction:** Extend Paywall props with a `context?: { vertical: "vehicle" | "property" | "family" | "health" | "scans" | "export"; reason: "limit_reached" | "feature_locked" | "general"; }` shape. Use it to (1) pre-select the smallest tier that satisfies the context (vehicle limit reached on free → preselect Personal; vehicle limit reached on Personal → preselect Pro), (2) render a small contextual hero above the tier list ("To add a 6th vehicle you'll need Pro" with a vehicle icon), (3) bold or accent-tint the relevant feature row inside each tier card, (4) optionally tint the CTA with the vertical accent. All call sites already have the data — no upstream plumbing needed beyond updating each `<Paywall>` invocation.
**Group 7 readiness:** READY

### PASS-D-012 — G6.11 Locked-card destinations route to a Paywall whose subtitle copy mismatches the user's intent

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `app/(tabs)/vehicles.tsx:225-236` (locked vehicle press) → `:276-283` (Paywall, subtitle "Adding more vehicles requires Pro."). `app/(tabs)/home-tab.tsx:174-187` (locked property press) → `:208-215` (Paywall, subtitle "Adding more properties requires Pro."). Health uses dynamic subtitles via `paywallSubtitle` set in `health.tsx:413-416, 421, openAddPet flow`.
**Evidence:** When a free-tier user has 4 vehicles but a vehicleLimit of 1, vehicles 2-4 are locked. Tapping a locked card sets `setShowPaywall(true)` (verified `vehicles.tsx:229-231`). The Paywall renders subtitle "Adding more vehicles requires Pro." — but the user did not tap an Add button; they tapped an existing locked vehicle they want to view. The copy is wrong for that intent.
**What's there today:** Tap-to-view-locked-vehicle and tap-Add-vehicle-FAB both surface the same paywall with the same "Adding more" copy. Same issue on home-tab. The health flow does it more carefully — `openPlanUpsell(subtitle)` passes a context-aware string at the call site, so "Adding more people requires Pro." vs. a future "View this person's records requires Pro." can be distinguished. Vehicles and home-tab don't have that affordance.
**Why it matters:** When G6.11 lands properly the Locked-card pattern will be the most common Paywall entry for users with multi-vehicle/multi-property usage. The copy mismatch ("Adding more" when you tapped to view) erodes trust in the rest of the messaging on that screen.
**Failure mode:** Free-tier ex-trial user comes back to look at the photo of their Tahoe (vehicle #2, locked). Taps it. Sees "Adding more vehicles requires Pro." Their reaction: "I'm not adding more, I just want to see the one I already had." Bounces.
**Fix direction:** Per PASS-D-011, take a `context.reason` prop. From `vehicles.tsx:229-231`, pass `reason: "locked_existing"` so Paywall renders "Unlock your other vehicles" (or similar copy). From the FAB (post-PASS-D-002), pass `reason: "limit_reached"` to render "Upgrade to add more vehicles." Same on home-tab. The two presentations should diverge in copy and possibly hero, while sharing tier cards.
**Group 7 readiness:** READY (depends on PASS-D-011 prop shape).

### PASS-D-013 — Modal vs bottom-sheet pattern: ScanPackModal is the only sheet-imitator; full-screen Paywall Modals are correct

**Severity:** PRE-LAUNCH (ScanPackModal only) / OK (Paywall sites)
**Pattern:** B
**Location:** ScanPackModal: `components/ScanPackModal.tsx:107-178` (covered in PASS-D-008). Paywall presentations: `app/(tabs)/vehicles.tsx:276`, `home-tab.tsx:208`, `health.tsx:771`, `vehicle/[id].tsx:1697`, `log-service/[vehicleId].tsx:693`, `add-vehicle.tsx:2171`, `add-property.tsx:575`, `add-family-member.tsx:203`.
**Evidence:** Project-wide grep for `@gorhom/bottom-sheet` returns zero matches (no proper bottom-sheet library is in use). All Paywall presentations are full-screen `<Modal>` from react-native, most with `presentationStyle="pageSheet"` (vehicles, home-tab, health) or default slide (vehicle/[id], log-service, add-vehicle, add-property, add-family-member). Full-screen modal is the appropriate iOS-native pattern for a multi-tier conversion surface, so this is fine. ScanPackModal is the outlier per PASS-D-008.
**What's there today:** Paywall: appropriate full-screen iOS Modal. ScanPackModal: full-screen Modal with overlay + manually-styled bottom sheet that has no real gesture handling.
**Why it matters:** Mixing a fake bottom sheet with real full-screen modals creates inconsistent affordances across the app's paid surfaces. The user learns "modals here behave like X" and then ScanPackModal breaks that mental model.
**Failure mode:** Already covered in PASS-D-008 (drag handle deception, Cancel-during-purchase race).
**Fix direction:** Either bring `@gorhom/bottom-sheet` in for ScanPackModal (heavier, but a clean foundation if more sheets are coming) OR remove the decorative drag handle from ScanPackModal and accept it as a tap-to-dismiss bottom sheet (lighter, sufficient for launch). Do not migrate Paywall to bottom-sheet — full-screen is correct for its content density.
**Group 7 readiness:** READY

### PASS-D-014 — Paid surfaces share no design language: Paywall, ScanPackModal, and the Settings tier banner each look like different products

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `components/Paywall.tsx:749-975` (styles), `components/ScanPackModal.tsx:182-270` (styles), `app/(tabs)/settings.tsx:462-499` (subscription banner), `app/(tabs)/settings.tsx:726-738` (Manage Subscription as a legal-row link), `app/subscription.tsx` (route just renders Paywall).
**Evidence:** Paywall uses 14px tierCard radius, 14px ctaBtn radius, accent CTA, segmented billing toggle. ScanPackModal uses 14px packCard radius, 12px error radius, 20px sheet radius, no segmented control. Settings banner (line 463-490) is a flat row with `bannerBtn` styled differently from either Paywall CTAs or pack-card CTAs. Manage Subscription is a tiny inline `legalBtnText` link nested in a row of legal links (lines 712-740) — the most important paid-action discovery moment is styled like a footer link.
**What's there today:** Each paid surface was built in isolation. There's no shared `<TierCard>`, `<PaidActionCTA>`, `<UpgradeBanner>`, or icon scheme. The result is three visually unrelated surfaces that all do "monetization."
**Why it matters:** Premium-feel apps reinforce paid moments through repeated visual language — the user starts to recognize "this is a paid surface" before reading copy. LifeMaintained's paid surfaces don't have that — each one feels improvised. This compounds the individual-surface issues in PASS-D-007/008/010/011.
**Failure mode:** A user toggles between Settings → /subscription (which renders a generic Paywall) → ScanPackModal (after running out of scans). Each surface looks like it belongs to a different app, and the user can't form a stable mental model of "this is what paying looks like in LifeMaintained."
**Fix direction:** Define a small "paid surface kit" before Group 7 touches individual surfaces: a `PaidHero` (icon + title + 2-line subtitle), a shared `TierCardShell` (used by Paywall today), and a consistent CTA height/radius/typography for all upgrade buttons. Promote the Settings banner CTA to use the same shape as Paywall CTAs. Move "Manage Subscription" out of the legal row and into a proper card under the tier banner. This is a focused upgrade, not a rewrite — the components mostly exist, they just need to be lifted to a shared layer.
**Group 7 readiness:** NEEDS FRESH SOURCE PULL — touches multiple components and warrants a per-surface diff before edits.

### PASS-D-015 — Per-vertical accent application is absent on the Paywall and ScanPackModal — every paid surface is generic orange

**Severity:** POST-LAUNCH
**Pattern:** B
**Location:** `components/Paywall.tsx:559` (selected card uses `cfg.color` which is the tier color, not the vertical color), `:848-855` (CTA hardcoded `Colors.accent`), `:531`, `:781` (billing toggle hardcoded accent). `components/ScanPackModal.tsx` styles use `Colors.accent` everywhere (`:120, 155, 162, 213, 217, 232-234, 240`).
**Evidence:** The app has `Colors.vehicle` (blue), `Colors.home` / `Colors.good` (green), `Colors.health` (also green-ish), used for vertical-accent applications across `app/(tabs)/index.tsx:48-50` and the per-tab screens. Paid surfaces ignore those vertical accents and default to orange across the board, even when invoked from a vertical context (e.g., locked vehicle card → Paywall stays orange instead of vehicle-blue).
**What's there today:** A user upsold from vehicles sees an all-orange Paywall with a blue Pro tier card (because Pro's color happens to be `Colors.vehicle`). The blue isn't tied to the user's intent — it's tied to the tier id. ScanPackModal is similarly always orange.
**Why it matters:** Vertical accents are a recurring product cue throughout the app (tabs, status dots, card icons). Dropping them on paid surfaces breaks consistency. Conversion impact is small — this is a polish item, not a launch issue.
**Failure mode:** Slight cognitive friction: a user from health tab is shown a green Pro tier (`Colors.health`) and an orange CTA, with no explanation of why. Two unrelated greens in the visual hierarchy.
**Fix direction:** Once PASS-D-011's `context.vertical` prop exists, allow the Paywall's CTA accent and the selected-card border to follow `verticalToColor(vertical)` instead of (or in addition to) the tier color. ScanPackModal can keep `Colors.accent` since it's only ever a scans surface, but should rename the variable internally to `scanAccent` to clarify intent. Don't over-do it: tier cards should keep their tier colors so cross-paywall comparison stays consistent.
**Group 7 readiness:** READY (small change; defer until vertical-context plumbing from PASS-D-011 lands).

### PASS-D-016 — Paywall has no free-tier comparison row; users can't see what they'd be losing or gaining

**Severity:** POST-LAUNCH
**Pattern:** B
**Location:** `components/Paywall.tsx:548-594` (only Personal/Pro/Business cards). `:596-602` (AI scan limits box mentions "Free: 0 AI scans/month" but only for scans, not for the broader feature set).
**Evidence:** TIER_CONFIG only has three tiers (line 26: `TierKey = "personal" | "pro" | "business"`). There is no fourth row for free, and the feature lists for the three paid tiers don't reference the free baseline. Free-tier limits in `lib/subscription.ts` (1 vehicle, 1 property, 0 family members, 0 scans, etc.) are encoded but never displayed in the Paywall.
**What's there today:** A user weighing whether to upgrade can't see what they'd lose by not upgrading or what's already included free. The "Save 40%" annual claim is the only loss-frame.
**Why it matters:** Comparison rows are a standard conversion-lift technique on B2C subscription paywalls (Spotify, Notion, etc.). Missing one is a polish gap, not a blocker.
**Failure mode:** Free user opens Paywall, sees three tiers all with "3 vehicles + 2 properties" / "6 vehicles + 5 properties" / "Unlimited," doesn't realize free is "1 vehicle + 1 property" — fails to perceive the upgrade as meaningful.
**Fix direction:** Add a "Free vs. paid" mini-row above the tier cards: 4 columns (icon, free, current paid tier, upgrade tier). Or, simpler: bold the relevant Pro/Business feature lines per context (covered in PASS-D-011). Either is fine — the latter is cheaper.
**Group 7 readiness:** READY (defer until PASS-D-010/011 land first; build on top of those).

### PASS-D-017 — "Save 40%" annual-billing claim on Paywall isn't true for two of three tiers

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `components/Paywall.tsx:539-541` (segmented-control label). Math reference: `:42-44` (Personal $7.99/mo, $49.99/yr), `:58-60` (Pro $11.99/mo, $99.99/yr), `:75-77` (Business $34.99/mo, $249.99/yr).
**Evidence:** Personal annual savings = (12 × $7.99 − $49.99) ÷ (12 × $7.99) = ($95.88 − $49.99) ÷ $95.88 = 47.9%. Pro = ($143.88 − $99.99) ÷ $143.88 = 30.5%. Business = ($419.88 − $249.99) ÷ $419.88 = 40.4%. The "Save 40%" label is hardcoded into the toggle and shown regardless of selected tier — true for Business, overstated for Pro by 10 percentage points, understated for Personal by 8 percentage points.
**What's there today:** Static "Save 40%" claim that's only roughly correct for one tier.
**Why it matters:** App Store review and consumer-protection rules (especially in EU/UK) require accurate price comparison claims. A user who annualizes Pro and notices it's only ~30% off may file a charge-back or complaint.
**Failure mode:** A finance-literate user does the math, posts on a forum that LifeMaintained inflates savings claims. App Store compliance review flags it during a future submission.
**Fix direction:** Compute savings per tier in code (a small `savingsPctFor(tier)` helper) and either (a) render the per-tier savings dynamically next to each tier card, or (b) replace "Save 40%" on the toggle with a tier-agnostic phrase ("Save up to 47%" or "Best value annual"). Avoid hardcoded percentage claims that aren't actually computed.
**Group 7 readiness:** READY

### PASS-D-018 — "Manage Subscription" entry point is a 13px legal-row link, not a paid-surface anchor

**Severity:** PRE-LAUNCH
**Pattern:** B
**Location:** `app/(tabs)/settings.tsx:712-740`. Visible only when `isPremium && !userIsInTrial && !!profile?.revenuecat_customer_id`.
**Evidence:** "Manage Subscription" is rendered inside the same row as "Terms of Service" and "Privacy Policy", styled as `legalBtnText` (line 717, 736 — same style key used for the legal links). Visually it's a 13px gray link sitting between footer dots. There is no card, no icon, no grouping with the tier banner at the top of Settings.
**What's there today:** A premium user looking to cancel or change billing scrolls to the very bottom of Settings, past account/notifications/budget/etc., to find a footer-styled link that opens iOS Settings. This is the cancellation path — Apple requires it to be reasonably accessible per App Store Review Guidelines 3.1.2.
**Why it matters:** (1) Compliance — ASRG 3.1.2 requires "in-app information about how to manage and cancel a subscription." A footer-styled link arguably meets the bar but is widely interpreted as the bare minimum, and Apple has rejected apps for similar burying. (2) Trust — premium users who feel they have to hunt for cancellation are less likely to renew.
**Failure mode:** App Store reviewer rejects an update with "subscription management is not sufficiently discoverable." Or, churned trialist takes 5+ minutes to find cancellation, leaves a 1-star review.
**Fix direction:** Move "Manage Subscription" out of the legal row into its own card adjacent to the premium tier banner (`settings.tsx:492-499`). Use the same card pattern as other Settings sections. Add a complementary "View receipts/billing history" row if one is feasible (RevenueCat customer center URL works). Keep the Apple deep link `itms-apps://apps.apple.com/account/subscriptions`. Free-tier and trial users should still see the upgrade CTA in the banner, not the manage link.
**Group 7 readiness:** READY

---

## Recommended Group 7 fix direction

The fixes split into three execution waves. Each wave's items are independent and parallelizable; waves themselves should be sequential because later waves build on earlier work.

### Wave 1 — Gate-timing fixes (Pattern A; no design dependency)

1. **Move ReceiptScanButton cap check to first tap.** Closes: PASS-D-001. Files: `components/ReceiptScanButton.tsx`, `app/log-service/[vehicleId].tsx`. Inject `profile` (or pre-derived `scansRemaining`) into `ReceiptScanButton`; in `showOptions` (or `handleScan`), if `scansRemaining(profile) <= 0`, fire `onPaidUserAtCap ?? onScanLimitReached` and return BEFORE `ImagePicker.launchCameraAsync`/`launchImageLibraryAsync`. Keep the server-side `scan_limit` branch as a defence-in-depth fallback. State owner unchanged (caller's `setShowScanPackModal`/`setShowPaywall`). Verify with: `rg -n 'launchCameraAsync\|launchImageLibraryAsync' components/ReceiptScanButton.tsx` returns hits inside the new gate-after-cap branch only. NEEDS FRESH SOURCE PULL: no — the file is short and recently inspected.

2. **Pre-gate Add Vehicle and Add Property FABs.** Closes: PASS-D-002, PASS-D-003. Files: `app/(tabs)/vehicles.tsx`, `app/(tabs)/home-tab.tsx`. Wrap each FAB and empty-state CTA's `onPress` with a count vs `vehicleLimit(profile)` / `propertyLimit(profile)` check; if at cap, set the existing `showPaywall` state (line 75 in vehicles.tsx, line 76 in home-tab.tsx) and return early. Keep the form-submit gates in `add-vehicle.tsx:976` and `add-property.tsx:281` as failsafes. Verify with: simulate capped state, confirm FAB tap opens Paywall without navigating.  NEEDS FRESH SOURCE PULL: no.

3. **Decide and implement voice flow tier coupling.** Closes: PASS-D-004. Files: `components/LogSheet.tsx`, possibly `components/Paywall.tsx` (if marketing copy needs to change). Product call required first: is voice paid (Personal+) or free with abuse cap? If paid: gate at `handleStartRecording` entry with `requirePaidTier(profile)`; route to Paywall on failure. If free: move the AsyncStorage check from `handleTranscribe` (line 559) to `handleStartRecording` (line 501) so the cap fires before mic permission. Update Paywall feature list at lines 49, 66, 82 to match the chosen model. NEEDS FRESH SOURCE PULL: yes — re-read after product decision.

### Wave 2 — Paid-surface UX upgrades (Pattern B, focused; depends on no other waves)

4. **ScanPackModal pack hierarchy + math correction + interaction-model fix.** Closes: PASS-D-007, PASS-D-008, PASS-D-013 (ScanPackModal portion). File: `components/ScanPackModal.tsx`. Compute per-scan price in code (no hardcoded percentages); replace `"Save 40%"` text with computed `"Save 33%"` or a tier-agnostic "Best Value" pill; differentiate the popular pack with a larger icon and deeper accent fill; disable the Cancel button (`:169-174`) while `purchasingId !== null`; remove the decorative drag handle OR migrate to `@gorhom/bottom-sheet` (recommend the lighter fix unless Wave 2 also commits to bottom-sheet for other surfaces). Verify with: open ScanPackModal, attempt swipe-down (no longer implies gesture), start purchase, attempt Cancel (disabled). NEEDS FRESH SOURCE PULL: no.

5. **Paywall tier card hierarchy.** Closes: PASS-D-010. File: `components/Paywall.tsx`. Render `cfg.icon` in the tier card top-row at `:564`; replace floating "Most Popular" caption with a real badge component (pill, accent fill, top-right inset of the popular card); add a small scale/shadow lift on the popular card; optionally add an accent chip behind the selected radio. No new state, no new props. NEEDS FRESH SOURCE PULL: no.

6. **ScanPackModal proactive entry from Settings.** Closes: PASS-D-009. Files: `app/(tabs)/settings.tsx`, `components/ScanPackModal.tsx` (host from settings). Add a "Scans" row between Account and Notifications showing `scansRemaining(profile)` plus credit balance (read `profile.scan_credits` if surfaced) and a "Buy more" CTA opening ScanPackModal. ScanPackModal already takes only `visible/onClose/onSuccess` — no API change. NEEDS FRESH SOURCE PULL: yes — settings.tsx not fully inspected for its existing card-layout pattern.

7. **Paywall "Save 40%" honesty fix.** Closes: PASS-D-017. File: `components/Paywall.tsx`. Add a `savingsPctFor(tier, billing)` helper, render per-tier savings on each tier card OR replace the toggle's hardcoded "Save 40%" with a dynamic best-case ("Save up to 47%"). Remove the hardcoded literal at line 540. NEEDS FRESH SOURCE PULL: no.

### Wave 3 — Context-aware paid surfaces (Pattern B, structural; depends on Wave 2 cards being clean)

8. **Add `context` prop to Paywall and propagate from every call site.** Closes: PASS-D-011, PASS-D-012, partially PASS-D-015 and PASS-D-016. Files: `components/Paywall.tsx`, every Paywall call site (`vehicles.tsx`, `home-tab.tsx`, `health.tsx`, `vehicle/[id].tsx`, `log-service/[vehicleId].tsx`, `add-vehicle.tsx`, `add-property.tsx`, `add-family-member.tsx`, `subscription.tsx`). Add `context?: { vertical: "vehicle" | "property" | "family" | "health" | "scans" | "export"; reason: "limit_reached" | "feature_locked" | "locked_existing" | "general"; }` to `PaywallProps`. Use it inside Paywall to (a) preselect the appropriate tier (free→Personal for limit_reached on starter caps, Personal→Pro for limit_reached on Personal caps), (b) render a small contextual hero above the tier list, (c) bold the relevant feature row inside each tier card, (d) tint the CTA with the vertical accent. Distinguish Locked-existing copy ("Unlock your other vehicles") from Limit-reached copy ("Upgrade to add more vehicles"). Verify with: grep `<Paywall` and confirm every call site passes `context`. NEEDS FRESH SOURCE PULL: yes — call sites have changed before; re-grep before editing.

9. **Paid-surface design language consistency pass.** Closes: PASS-D-014. Files: `components/Paywall.tsx`, `components/ScanPackModal.tsx`, `app/(tabs)/settings.tsx`. Lift CTA height/radius/typography from Paywall into a shared `PaidActionCTA` component (or a styles export); reuse on the Settings tier banner CTA, the ScanPackModal pack-card layout, and any new "Buy scans" CTA from Wave 2 item 6. Move "Manage Subscription" out of the Settings legal row (`settings.tsx:712-740`) into a proper card under the tier banner (closes PASS-D-018 simultaneously). NEEDS FRESH SOURCE PULL: yes — multiple files; do a per-file diff before editing.

### Optional / defer

10. **Paywall free-tier comparison row** — PASS-D-016 — small win, build on Wave 3 once context plumbing exists. NEEDS FRESH SOURCE PULL: no.

11. **Repair-cost estimate tier gating** — PASS-D-005 — only if margins demand it; not a launch issue. NEEDS FRESH SOURCE PULL: no.

12. **Onboarding generation ungated** — PASS-D-006 — no action; document in a comment if helpful. NEEDS FRESH SOURCE PULL: no.

---

## Out-of-scope notes

- `supabase/functions/scan-receipt/` — server-side cap enforcement is the source of truth for `scan_limit` responses; client-side fix in PASS-D-001 needs to remain compatible with server signaling — future server-side audit pass.
- `lib/receiptScanner.ts:62-103` — error-shape parsing is fragile (mixed JSON/non-JSON branches at lines 85-103); not a Pass D concern but worth a Pass E or hardening pass.
- `app/_layout.tsx:100-264` — RevenueCat configuration and customer-info listener wiring; out of paid-surface UX scope but relevant if Group 7 needs a refreshProfile signal — future RC plumbing pass.
- `lib/notificationScheduler.ts` — notifications scheduler reads tier-relevant tables but does not present any paid surfaces — out of scope.
- `lib/supabase-types.ts` — generated types; ignore.
- `app/family-member/[id].tsx`, `app/property/[id].tsx`, `app/vehicle/[id].tsx` photo upload paths — paid users get image upload to storage with no tier gate; not a paid-action surface in this audit's sense — future storage-quota pass.
- `app/(onboarding)/value-reveal.tsx` — first-vehicle reveal screen; not currently paid-gated by design (PASS-D-006) — out of scope.
- `app/notifications-settings.tsx` — mute-list UI; not a paid surface — out of scope.
- `components/Tooltip.tsx` — tutorial tooltips; not paid-relevant — out of scope.
- "Apply promo code" UX inside Paywall (`Paywall.tsx:686-735`) — functional but visually a secondary path; could be promoted but not a launch blocker — future promo UX pass.

---

*End of Pass D findings doc.*


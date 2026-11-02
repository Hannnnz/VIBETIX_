import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { AuthService } from '../services/auth.service';
import { Review, ReviewService, ReviewSort } from '../services/review.service';
import { SupabaseService } from '../services/supabase.service';
import { runRefresh } from '../utils/refresher';

interface TicketTier {
  id?: string;
  name: string;
  price: number;
  perks: string;
}

type TierGroupKey = 'svip' | 'vip' | 'lower' | 'upper' | 'gen';
type MapFilterKey = TierGroupKey | 'all';

interface TierGroupConfig {
  key: TierGroupKey;
  label: string;
  /** Normalised backend names that belong to this visual group. */
  tierNames: string[];
  perk: string;
}

interface ArenaSection {
  id: string;
  group: TierGroupKey;
  label: string;
  /** Short map/seat prefix, e.g. V3. */
  short: string;
  path: string;
  labelX: number;
  labelY: number;
  fontSize: number;
}

interface RingSpec {
  group: TierGroupKey;
  inner: number;
  outer: number;
  /** Angle spans in degrees. 0 = right, 90 = down. */
  spans: [number, number][];
  sectionsPerSpan: number;
  prefix: string;
  gap: number;
  fontSize: number;
}

const MAX_SEATS = 6;

const MAP = {
  cx: 200,
  cy: 172,
  scaleY: 0.72,
  viewBox: '0 0 400 344',
  outerRadius: 190,
} as const;

/** Visual groups in stacking order from the stage outwards. */
const TIER_GROUPS: TierGroupConfig[] = [
  {
    key: 'svip',
    label: 'SVIP',
    tierNames: ['svip'],
    perk: 'Front zone + artist merch pack',
  },
  {
    key: 'vip',
    label: 'VIP',
    tierNames: ['vip'],
    perk: 'Premium seated area + VIP lane',
  },
  {
    key: 'lower',
    label: 'Lower Box',
    tierNames: ['lowerbox', 'lower'],
    perk: 'Reserved seat, closer stage',
  },
  {
    key: 'upper',
    label: 'Upper Box',
    tierNames: ['upperbox', 'upper'],
    perk: 'Reserved seat, elevated view',
  },
  {
    key: 'gen',
    label: 'Gen Ad',
    tierNames: ['genad', 'generaladmission'],
    perk: 'Free seating section',
  },
];

const RINGS: RingSpec[] = [
  {
    group: 'svip',
    inner: 44,
    outer: 72,
    spans: [[-90, 270]],
    sectionsPerSpan: 4,
    prefix: 'S',
    gap: 3,
    fontSize: 11,
  },
  {
    group: 'vip',
    inner: 78,
    outer: 106,
    spans: [[-90, 270]],
    sectionsPerSpan: 8,
    prefix: 'V',
    gap: 2.5,
    fontSize: 10.5,
  },
  {
    group: 'lower',
    inner: 112,
    outer: 140,
    spans: [[-90, 270]],
    sectionsPerSpan: 12,
    prefix: 'L',
    gap: 2,
    fontSize: 9.5,
  },
  {
    group: 'upper',
    inner: 146,
    outer: 168,
    spans: [[-90, 270]],
    sectionsPerSpan: 16,
    prefix: 'U',
    gap: 1.5,
    fontSize: 8.5,
  },
  {
    // Gen Ad sits on the left/right sides, outside the Upper Box.
    group: 'gen',
    inner: 170,
    outer: 190,
    spans: [
      [-62, 62],
      [118, 242],
    ],
    sectionsPerSpan: 2,
    prefix: 'G',
    gap: 3,
    fontSize: 8,
  },
];

function polarPoint(radius: number, angleDeg: number): { x: number; y: number } {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: MAP.cx + radius * Math.cos(angle),
    y: MAP.cy + radius * Math.sin(angle) * MAP.scaleY,
  };
}

/** Builds an annular sector path from polar coordinates — no hardcoded paths. */
function annularSectorPath(
  inner: number,
  outer: number,
  startAngle: number,
  endAngle: number
): string {
  const steps = Math.max(4, Math.ceil(Math.abs(endAngle - startAngle) / 6));
  const points: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + ((endAngle - startAngle) * i) / steps;
    const p = polarPoint(inner, angle);
    points.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }
  for (let i = steps; i >= 0; i--) {
    const angle = startAngle + ((endAngle - startAngle) * i) / steps;
    const p = polarPoint(outer, angle);
    points.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }

  return `M${points.join('L')}Z`;
}

function buildArenaSections(): ArenaSection[] {
  const sections: ArenaSection[] = [];

  for (const ring of RINGS) {
    const group = TIER_GROUPS.find((g) => g.key === ring.group)!;
    let sectionNumber = 1;

    for (const [spanStart, spanEnd] of ring.spans) {
      const step = (spanEnd - spanStart) / ring.sectionsPerSpan;

      for (let i = 0; i < ring.sectionsPerSpan; i++) {
        const rawStart = spanStart + i * step;
        const rawEnd = rawStart + step;
        const start = rawStart + ring.gap / 2;
        const end = rawEnd - ring.gap / 2;
        const mid = (rawStart + rawEnd) / 2;
        const labelPoint = polarPoint(
          ring.inner + (ring.outer - ring.inner) * 0.5,
          mid
        );
        const short = `${ring.prefix}${sectionNumber}`;

        sections.push({
          id: `${ring.group}-${sectionNumber}`,
          group: ring.group,
          label: `${group.label} ${sectionNumber}`,
          short,
          path: annularSectorPath(ring.inner, ring.outer, start, end),
          labelX: labelPoint.x,
          labelY: labelPoint.y,
          fontSize: ring.fontSize,
        });
        sectionNumber += 1;
      }
    }
  }

  return sections;
}

@Component({
  selector: 'app-concert-detail',
  templateUrl: './concert-detail.page.html',
  styleUrls: ['./concert-detail.page.scss'],
  standalone: false,
})
export class ConcertDetailPage implements OnInit, OnDestroy {
  concert: Concert | undefined;
  tiers: TicketTier[] = [];
  selectedTier: TicketTier | null = null;

  /** Seat grid: rows A–D × seats 1–8, scoped per arena section. */
  readonly rows = ['A', 'B', 'C', 'D'];
  readonly cols = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly maxSeats = MAX_SEATS;

  readonly sections = buildArenaSections();
  readonly tierGroups = TIER_GROUPS;
  readonly filterChips: { key: MapFilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    ...TIER_GROUPS.map((group) => ({ key: group.key, label: group.label })),
  ];
  readonly mapViewBox = MAP.viewBox;
  readonly mapCenterX = MAP.cx;
  readonly mapCenterY = MAP.cy;
  readonly mapScaleY = MAP.scaleY;
  readonly mapOuterRadius = MAP.outerRadius;

  taken = new Set<string>();
  selected = new Set<string>();
  activeSection: ArenaSection | null = null;
  filterKey: MapFilterKey = 'all';
  genAdQty = 1;
  seatsLoading = false;
  buying = false;

  tooltipSection: ArenaSection | null = null;
  tooltipX = 0;
  tooltipY = 0;

  // ── Reviews ──────────────────────────────────────────────────────
  readonly stars = [1, 2, 3, 4, 5];
  readonly starRows = [5, 4, 3, 2, 1];
  readonly reviewSorts: { key: ReviewSort; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'highest', label: 'Highest rated' },
    { key: 'lowest', label: 'Lowest rated' },
    { key: 'helpful', label: 'Most helpful' },
  ];
  reviews: Review[] = [];
  reviewAverage = 0;
  reviewTotal = 0;
  reviewCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviewsLoading = false;
  reviewsError = '';
  reviewSort: ReviewSort = 'newest';
  readonly helpfulBusy = new Set<string>();

  @ViewChild('seatPanel') private seatPanel?: ElementRef<HTMLElement>;

  private tooltipTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private concertService: ConcertService,
    public auth: AuthService,
    private reviewService: ReviewService,
    private sb: SupabaseService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {}

  ngOnInit(): void {
    void this.ionViewWillEnter();
  }

  ngOnDestroy(): void {
    this.clearTooltipTimer();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  /** Pull-down-to-refresh refetches the event + taken seats. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, () => this.load());
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') || '';
    // Hydrate + direct-fetch fallback so a created event is never reported
    // as "not found" just because the local cache was empty/stale.
    const found = await this.concertService.ensureLoaded(id);
    this.zone.run(() => {
      this.concert = found;
      this.cdr.detectChanges();
      if (this.concert) {
        const perks: Record<string, string> = {
          'Gen Ad': 'Free seating section',
          'Upper Box': 'Reserved seat, elevated view',
          'Lower Box': 'Reserved seat, closer stage',
          VIP: 'Premium seated area + VIP lane',
          SVIP: 'Front zone + artist merch pack',
        };
        this.tiers = this.concertService.tiersFor(this.concert.id).map((t) => ({
          id: t.id,
          name: t.name,
          price: Math.round(this.concert!.price * t.multiplier),
          perks: perks[t.name] ?? 'Standard access',
        }));
        this.selectedTier = this.selectedTier
          ? this.tiers.find((t) => t.name === this.selectedTier!.name) ?? null
          : null;
        this.selected = new Set<string>();
        this.activeSection = null;
        this.genAdQty = 1;
        this.filterKey = this.tierGroup(this.selectedTier) ?? 'all';
      }
    });
    if (this.concert) {
      await Promise.all([this.loadTakenSeats(), this.loadReviews()]);
    }
    this.cdr.detectChanges();
  }

  /** Sold seats straight from the bookings table (always current). */
  private async loadTakenSeats(): Promise<void> {
    if (!this.concert) {
      return;
    }
    this.seatsLoading = true;
    try {
      const { data, error } = await this.sb.client
        .from('seats')
        .select('seat_code')
        .eq('concert_id', this.concert.id);
      if (error) {
        return;
      }
      const codes = (data ?? [])
        .map((s) => String((s as { seat_code: string }).seat_code ?? '').trim().toUpperCase())
        .filter((code) => code.length > 0);
      this.zone.run(() => (this.taken = new Set(codes)));
      this.cdr.detectChanges();
    } catch {
      /* offline — keep the last known availability */
    } finally {
      this.seatsLoading = false;
      this.cdr.detectChanges();
    }
  }

  rulesList(): string[] {
    return (this.concert?.rules ?? '')
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  }

  // ── Reviews ──────────────────────────────────────────────────────

  async loadReviews(): Promise<void> {
    if (!this.concert) {
      return;
    }
    this.reviewsLoading = true;
    this.reviewsError = '';
    this.cdr.detectChanges();
    try {
      const summary = await this.reviewService.forEvent(
        this.concert.id,
        this.reviewSort
      );
      this.zone.run(() => {
        this.reviews = summary.reviews;
        this.reviewAverage = summary.average;
        this.reviewTotal = summary.total;
        this.reviewCounts = summary.counts;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.zone.run(() => {
        this.reviews = [];
        this.reviewAverage = 0;
        this.reviewTotal = 0;
        this.reviewCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        this.reviewsError =
          (error as Error)?.message ?? 'Could not load reviews right now.';
        this.cdr.detectChanges();
      });
    } finally {
      this.reviewsLoading = false;
      this.cdr.detectChanges();
    }
  }

  changeReviewSort(value: ReviewSort): void {
    if (this.reviewSort === value) {
      return;
    }
    this.reviewSort = value;
    void this.loadReviews();
  }

  reviewCount(star: number): number {
    return this.reviewCounts[star] ?? 0;
  }

  barPercent(star: number): number {
    if (!this.reviewTotal) {
      return 0;
    }
    return Math.round((this.reviewCount(star) / this.reviewTotal) * 100);
  }

  isOwnReview(review: Review): boolean {
    const userId = this.auth.getUserId();
    return !!userId && userId === review.userId;
  }

  async toggleHelpful(review: Review): Promise<void> {
    if (this.helpfulBusy.has(review.id)) {
      return;
    }
    this.helpfulBusy.add(review.id);
    this.cdr.detectChanges();
    try {
      const result = await this.reviewService.toggleHelpful(review.id);
      this.zone.run(() => {
        review.helpfulCount = result.count;
        review.userHelpful = result.helpful;
        this.cdr.detectChanges();
      });
    } catch (error) {
      void this.toast(
        (error as Error)?.message ?? 'Could not update that vote.',
        'warning'
      );
    } finally {
      this.helpfulBusy.delete(review.id);
      this.cdr.detectChanges();
    }
  }

  async reportReview(review: Review): Promise<void> {
    const reasons = [
      'Spam or advertising',
      'Offensive language',
      'Harassment or hate',
      'Not about this event',
      'Other',
    ];
    const alert = await this.alertCtrl.create({
      header: 'Report review',
      message: 'Why are you reporting this review?',
      inputs: reasons.map((reason, index) => ({
        type: 'radio' as const,
        label: reason,
        value: reason,
        checked: index === 0,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Report',
          handler: (value: string) => {
            if (!value) {
              return false;
            }
            void this.submitReport(review, value);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  private async submitReport(review: Review, reason: string): Promise<void> {
    try {
      await this.reviewService.report(review.id, reason);
      void this.toast('Report sent — our team will review it.', 'dark');
    } catch (error) {
      void this.toast(
        (error as Error)?.message ?? 'Could not send that report.',
        'warning'
      );
    }
  }

  // ── Ticket type ↔ map group ──────────────────────────────────────

  private normaliseTierName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private groupConfig(key: TierGroupKey): TierGroupConfig {
    return TIER_GROUPS.find((group) => group.key === key)!;
  }

  /** The actual backend tier for a visual group (prices come from here). */
  tierForGroup(key: TierGroupKey): TicketTier | undefined {
    const group = this.groupConfig(key);
    return this.tiers.find((tier) =>
      group.tierNames.includes(this.normaliseTierName(tier.name))
    );
  }

  groupLabel(key: TierGroupKey): string {
    return this.tierForGroup(key)?.name ?? this.groupConfig(key).label;
  }

  tierGroup(tier: TicketTier | null): TierGroupKey | null {
    if (!tier) {
      return null;
    }
    const normalised = this.normaliseTierName(tier.name);
    return (
      TIER_GROUPS.find((group) => group.tierNames.includes(normalised))?.key ?? null
    );
  }

  isGenAdSelected(): boolean {
    return this.tierGroup(this.selectedTier) === 'gen';
  }

  // ── Map interactions ─────────────────────────────────────────────

  sectionClasses(section: ArenaSection): Record<string, boolean> {
    return {
      [`group-${section.group}`]: true,
      dim: this.isDimmed(section),
      emph: this.isEmphasized(section),
      active: this.activeSection?.id === section.id,
      unavailable: !this.tierForGroup(section.group),
    };
  }

  isDimmed(section: ArenaSection): boolean {
    return this.filterKey !== 'all' && section.group !== this.filterKey;
  }

  isEmphasized(section: ArenaSection): boolean {
    return this.tierGroup(this.selectedTier) === section.group;
  }

  isSectionUnavailable(section: ArenaSection): boolean {
    return !this.tierForGroup(section.group);
  }

  sectionAria(section: ArenaSection): string {
    const tier = this.tierForGroup(section.group);
    const type = tier?.name ?? this.groupConfig(section.group).label;
    const price = tier ? `${this.formatPrice(tier.price)} each` : 'unavailable';
    return `${section.label}, ${type}, ${price}. ${
      tier ? 'Open the seat picker.' : 'This ticket type is unavailable.'
    }`;
  }

  setFilter(key: MapFilterKey): void {
    this.filterKey = key;
    this.hideSectionTip();
  }

  chooseTier(tier: TicketTier): void {
    const nextGroup = this.tierGroup(tier);
    if (this.selectedTier?.name !== tier.name) {
      this.clearSeatSelection();
    }
    this.selectedTier = tier;
    this.filterKey = nextGroup ?? 'all';
    this.hideSectionTip();
  }

  onTierKeydown(event: KeyboardEvent, tier: TicketTier): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.chooseTier(tier);
    }
  }

  openSection(section: ArenaSection): void {
    const tier = this.tierForGroup(section.group);
    if (!tier) {
      void this.toast('That ticket type is not available for this event.', 'warning');
      return;
    }

    if (this.tierGroup(this.selectedTier) !== section.group) {
      this.clearSeatSelection();
    }
    this.selectedTier = tier;
    this.filterKey = section.group;
    this.activeSection = section;
    this.hideSectionTip();
    this.cdr.detectChanges();

    // Refresh availability in the background; the grid paints from cache
    // immediately and disables anything that sold while the page was open.
    void this.loadTakenSeats();

    setTimeout(() => {
      this.seatPanel?.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }, 0);
  }

  onSectionKeydown(event: KeyboardEvent, section: ArenaSection): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openSection(section);
    }
  }

  closeSection(): void {
    this.activeSection = null;
    this.hideSectionTip();
  }

  showSectionTip(event: PointerEvent, section: ArenaSection): void {
    this.tooltipSection = section;
    this.positionTooltip(event.clientX, event.clientY);
    this.clearTooltipTimer();
    if (event.pointerType === 'touch') {
      this.tooltipTimer = setTimeout(() => {
        this.hideSectionTip();
        this.cdr.detectChanges();
      }, 2600);
    }
  }

  showSectionTipForFocus(section: ArenaSection, event: FocusEvent): void {
    this.tooltipSection = section;
    const target = event.target as Element | null;
    if (target) {
      const rect = target.getBoundingClientRect();
      this.positionTooltip(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    this.clearTooltipTimer();
  }

  hideSectionTip(): void {
    this.clearTooltipTimer();
    this.tooltipSection = null;
  }

  private clearTooltipTimer(): void {
    if (this.tooltipTimer) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = undefined;
    }
  }

  private positionTooltip(clientX: number, clientY: number): void {
    const width = 224;
    const height = 86;
    const pad = 10;
    let x = clientX + 14;
    let y = clientY + 16;

    if (typeof window !== 'undefined') {
      if (x + width > window.innerWidth - pad) {
        x = clientX - width - 14;
      }
      if (x < pad) {
        x = pad;
      }
      if (y + height > window.innerHeight - pad) {
        y = clientY - height - 14;
      }
      if (y < pad) {
        y = pad;
      }
    }

    this.tooltipX = x;
    this.tooltipY = y;
  }

  formatPrice(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  // ── Seats ────────────────────────────────────────────────────────

  seatCode(section: ArenaSection, row: string, col: number): string {
    return `${section.short}-${row}${col}`.toUpperCase();
  }

  isSeatTaken(code: string): boolean {
    const normalised = code.trim().toUpperCase();
    if (this.taken.has(normalised)) {
      return true;
    }
    // Legacy bookings used bare A1…D8 before sections existed. Keep those
    // seats blocked everywhere so the old inventory can never be resold.
    const legacy = normalised.split('-').pop() ?? normalised;
    return this.taken.has(legacy);
  }

  isSeatSelected(code: string): boolean {
    return this.selected.has(code.toUpperCase());
  }

  seatAria(section: ArenaSection, row: string, col: number): string {
    const code = this.seatCode(section, row, col);
    const state = this.isSeatTaken(code)
      ? 'taken'
      : this.isSeatSelected(code)
        ? 'selected'
        : 'available';
    return `${section.label}, seat ${row}${col}, ${state}`;
  }

  toggleSeat(code: string): void {
    if (!this.selectedTier || this.isSeatTaken(code)) {
      return;
    }
    const normalised = code.toUpperCase();
    if (this.selected.has(normalised)) {
      this.selected.delete(normalised);
      this.cdr.detectChanges();
      return;
    }
    if (this.selected.size >= this.maxSeats) {
      void this.toast(`Up to ${this.maxSeats} tickets per purchase.`, 'warning');
      return;
    }
    this.selected.add(normalised);
    this.cdr.detectChanges();
  }

  changeGenAdQty(delta: number): void {
    if (!this.isGenAdSelected()) {
      return;
    }
    const next = Math.min(this.maxSeats, Math.max(1, this.genAdQty + delta));
    if (next === this.genAdQty) {
      if (delta > 0) {
        void this.toast(`Up to ${this.maxSeats} tickets per purchase.`, 'warning');
      }
      return;
    }
    this.genAdQty = next;
    this.cdr.detectChanges();
  }

  seats(): string[] {
    return [...this.selected].sort();
  }

  selectionCount(): number {
    if (!this.selectedTier) {
      return 0;
    }
    return this.isGenAdSelected() ? this.genAdQty : this.selected.size;
  }

  seatCount(): number {
    return this.selected.size;
  }

  summarySeats(): string[] {
    if (!this.selectedTier) {
      return [];
    }
    if (this.isGenAdSelected()) {
      return [`Gen Ad × ${this.genAdQty}`];
    }
    return this.seats().map((code) => {
      const section = this.sectionForSeat(code);
      const local = code.split('-').pop() ?? code;
      return section ? `${section.short} · ${local}` : code;
    });
  }

  private sectionForSeat(code: string): ArenaSection | undefined {
    return this.sections.find((section) => code.startsWith(`${section.short}-`));
  }

  private seatLabel(code: string): string {
    const section = this.sectionForSeat(code);
    const local = code.split('-').pop() ?? code;
    return section ? `${section.label} ${local}` : code;
  }

  total(): number {
    return (this.selectedTier?.price ?? 0) * this.selectionCount();
  }

  canBuy(): boolean {
    return !!this.selectedTier && this.selectionCount() > 0 && !this.buying;
  }

  buyLabel(): string {
    const count = this.selectionCount();
    if (count === 0) {
      return 'Buy tickets';
    }
    return `Buy ${count} ticket${count === 1 ? '' : 's'}`;
  }

  private clearSeatSelection(): void {
    this.selected = new Set<string>();
    this.activeSection = null;
    this.genAdQty = 1;
  }

  /** Gen Ad has no seat numbers; these tokens only reserve a quantity. */
  private genAdSeatCodes(): string[] {
    const batch = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`.toUpperCase();
    return Array.from(
      { length: this.genAdQty },
      (_, index) => `GA-${batch}-${index + 1}`
    );
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /** Hands the order over to the checkout / payment page. */
  async buy(): Promise<void> {
    if (this.buying) {
      return;
    }
    if (!this.selectedTier || this.selectionCount() === 0) {
      return;
    }

    this.buying = true;
    this.cdr.detectChanges();
    let navigated = false;

    try {
      await this.auth.ensureSession().catch(() => undefined);
      const session = this.auth.getSession();
      if (!session || !this.concert) {
        void this.toast('Please sign in again to continue checkout.', 'primary');
        return;
      }

      let seats: string[];

      if (this.isGenAdSelected()) {
        seats = this.genAdSeatCodes();
      } else {
        // Re-check availability right before checkout: if someone else
        // grabbed one of these seats while this page was open, don't send
        // the customer into a failing payment — drop the seats, refresh the
        // grid and say so immediately.
        await this.loadTakenSeats();
        const conflicts = [...this.selected].filter((code) =>
          this.isSeatTaken(code)
        );
        if (conflicts.length > 0) {
          conflicts.forEach((code) => this.selected.delete(code));
          this.cdr.detectChanges();
          void this.toast(
            `${conflicts.map((code) => this.seatLabel(code)).join(', ')} just sold out — seats refreshed, pick another.`,
            'warning'
          );
          return;
        }
        seats = this.seats();
      }

      if (seats.length === 0) {
        return;
      }

      await this.router.navigate(['/payment'], {
        queryParams: {
          id: this.concert.id,
          tier: this.selectedTier.name,
          tierId: this.selectedTier.id ?? '',
          price: this.selectedTier.price,
          seats: seats.join(','),
        },
      });
      navigated = true;
    } finally {
      this.buying = false;
      if (!navigated) {
        try {
          this.cdr.detectChanges();
        } catch {
          /* the view may already be gone */
        }
      }
    }
  }

  private async toast(message: string, color = 'dark'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'top',
      color,
    });
    await toast.present();
  }
}

import { AfterViewInit, ChangeDetectorRef, Component, DestroyRef, EventEmitter, inject, NgZone, OnDestroy, OnInit, Output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { lastValueFrom } from 'rxjs';
import { DateTime } from 'luxon';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { FormBuilder, FormsModule, ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { NgdsFormsModule } from '@digitalspace/ngds-forms';
import { ProductService } from '../services/product.service';
import { ProductDateService } from '../services/product-date.service';
import { InventoryPoolService } from '../services/inventory-pool.service';
import { Constants } from '../constants';
import { CartService, CartItem, holdReleaseNotes } from '../services/cart.service';
import { ToastService, ToastTypes } from '../services/toast.service';
import { AuthService } from '../services/auth.service';
import { ServerTimeService } from '../services/server-time.service';
import { WaitingRoomService } from '../services/waiting-room.service';
import { ApiService } from '../services/api.service';
import { BreadcrumbComponent } from '../shared/breadcrumb/breadcrumb.component';
import { BsModalService } from 'ngx-bootstrap/modal';
import { ConfirmationModalComponent } from '../shared/components/confirmation-modal/confirmation-modal.component';
import { BookingService, parseHoldRetryAt } from '../services/booking.service';
import { AccountVerificationComponent } from '../shared/components/account-verification/account-verification.component';
import { HoldRetryNoticeComponent } from '../shared/components/hold-retry-notice/hold-retry-notice.component';
import { pageTitle } from '../page-title.strategy';
import { BookingUtils } from '../utils/booking-utils';
import { AvailabilitySelection, AvailabilityState, evaluateAvailability, PassOption } from './availability-state';

@Component({
  selector: 'app-facility-details',
  host: { class: 'h-100' },
  imports: [CommonModule, ReactiveFormsModule, FormsModule, NgdsFormsModule, BreadcrumbComponent, RouterLink, AccountVerificationComponent, HoldRetryNoticeComponent],
  templateUrl: './facility-details.component.html',
  styleUrls: ['./facility-details.component.scss']
})
export class FacilityDetailsComponent implements OnInit, AfterViewInit, OnDestroy {
  @Output() formValue: EventEmitter<any> = new EventEmitter<any>();
  public emailVerified = false;
  public emailVerificationLoaded = false;
  
  public form: UntypedFormGroup;
  public facilityOpen = true;
  public isLoggedIn = false;
  public availabilityState: AvailabilityState = { status: 'idle' };
  private windowTimer: any = null;
  private availabilityRequest = 0;
  private productDatesRequest = 0;
  private activityRequest = 0;
  private readonly noPassOptions: PassOption[] = [];
  public loadingProducts = false;
  public loadingDates = false;
  
  public facility;
  public geozone;
  // The API answers a missing facility with 200 and a null body, so the resolver
  // hands this component null rather than failing the navigation. Render an
  // explicit error state instead of a page with nothing on it.
  public facilityLoadFailed = false;
  
  public activeSection = 'day-use-pass-notice';
  private sectionEls: HTMLElement[] = [];
  private readonly scrollEvents = ['scroll', 'resize'];

  public relatedActivities: any[] = [];
  public availableActivities: any = [];
  
  public availableProducts: any = [];

  public availableDates: any = {};
  // Distinguishes "the availability lookup failed" from "there genuinely are no passes" —
  // the two rendered identically, so an API outage looked like a sold-out facility.
  public datesLoadFailed = false;
  public startDate = DateTime.now().startOf('day');
  public endDate = this.startDate.plus({ days: 2 });

  get passStatus() { return this.availabilityState.status; }
  get passesAvailable() { return this.availabilityState.status === 'available'; }
  get loadingPasses() { return this.availabilityState.status === 'loading'; }
  get availableVisitorsAllowed() {
    return this.availabilityState.status === 'available' ? this.availabilityState.options : this.noPassOptions;
  }
  // In park time, so a visitor in another zone is told 7:00 AM Pacific, not their local hour.
  get reservationOpensAt(): DateTime | null {
    return this.availabilityState.status === 'not-open-yet' ? this.availabilityState.opensAt : null;
  }

  private selectedCollectionId: string;
  private selectedActivityType: string;
  private selectedActivityId: string;
  public selectedActivitySubType: string | null = null;
  private selectedActivityName: string;
  public selectedProductName: string;
  public passValidity: string | null = null;
  private selectedDateStr: string;
  private waitingRoomActive = false;
  // Set from a hold-create 429; applies only to the product and date it was returned for.
  private holdRetry: { key: string; retryAt: DateTime } | null = null;

  private destroyRef = inject(DestroyRef);
  private cartService = inject(CartService);
  private toastService = inject(ToastService);
  private waitingRoomService = inject(WaitingRoomService);
  private apiService = inject(ApiService);
  private inventoryPoolService = inject(InventoryPoolService);
  private modalService = inject(BsModalService);
  private bookingService = inject(BookingService);
  private zone = inject(NgZone);
  private titleService = inject(Title);

  constructor(
    private route: ActivatedRoute,
    private fb: FormBuilder,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private productService: ProductService,
    private productDateService: ProductDateService,
    private authService: AuthService,
    private serverTime: ServerTimeService,
  ) {
    this.facility = this.route.snapshot.data['facility'] ?? null;
    this.facilityLoadFailed = !this.facility;
    // Every other read here is optional-chained; this one was not, so a null
    // facility threw in the constructor and Angular rendered nothing at all.
    this.geozone = this.facility?.geozones?.[0] ?? null;
    if (!this.facility?.isOpen) this.facilityOpen = false;

    // If this facility has activities, add them to relatedActivities. The activity
    // is no longer user-selectable (#705) — it is resolved from the facility and
    // drives the product lookup below.
    this.relatedActivities = this.facility?.activities || []

    this.availableActivities = this.relatedActivities.map(activity => {
      return {
        display: activity?.displayName,
        value: `${activity?.pk}#${activity?.sk}`,
        meta: activity
      }
    });

  }

  async ngOnInit() {
    // Not in the constructor: the router's TitleStrategy runs after activation and would overwrite it.
    if (this.facility?.displayName) {
      this.titleService.setTitle(pageTitle(this.facility.displayName));
    }

    // Initialize the form first so the template can bind immediately
    this.initializeForm();

    // Track auth state separately from facilityOpen so the template can show
    // a "log in to book" prompt instead of the misleading "facility is closed"
    // alert (issue #465).
    this.isLoggedIn = !!this.authService.getCurrentUser();
    if (this.isLoggedIn) {
      await this.checkUserEmailVerification();
    }


    // Returning from the waiting room admits the user back to this page with their
    // prior selections in the query params (#259) — restore those instead of the
    // activity auto-select below.
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('activity')) {
      await this.restoreSelectionsFromQueryParams(qp);
      return;
    }

    // The Activity picker was removed (#705) — a facility-level day-use pass has
    // no meaningful choice to offer, so resolve the activity here and pre-load its
    // products. Falls back to the first activity if a facility ever carries more
    // than one, so the rest of the flow still has an activity to book against.
    if (this.availableActivities.length) {
      const activity = this.availableActivities[0].value;
      // Set the control value without emitting so the valueChanges subscription doesn't fire a duplicate call
      this.form.get('selectedActivity').setValue(activity, { emitEvent: false });
      await this.setFormProduct(activity);
    }
  }

  private async restoreSelectionsFromQueryParams(qp: ParamMap) {
    const activity = qp.get('activity');
    this.form.get('selectedActivity').setValue(activity, { emitEvent: false });
    await this.setFormProduct(activity);

    const product = qp.get('product');
    if (!product) return;
    this.form.get('selectedProduct').setValue(product, { emitEvent: false });
    await this.loadProductDates(product);

    const date = qp.get('date');
    if (!date) return;
    this.form.get('selectedDate').setValue(date, { emitEvent: false });
    await this.loadPassesAvailable(date);

    // Inventory can move while the user waits, so only restore a count the
    // recomputed availability still offers — otherwise fail it here, not at booking.
    const visitors = qp.get('visitors');
    if (visitors && this.availableVisitorsAllowed.some(v => v.value === visitors)) {
      this.form.get('selectedVisitors').setValue(visitors, { emitEvent: false });
    }
  }

  private initializeForm() {
    this.form = this.fb.group({
      selectedActivity: [null, {
        updateOn: 'blur'
      }],
      selectedProduct: [null, {
        updateOn: 'blur'
      }],
      selectedDate: [null, {
        updateOn: 'blur'
      }],
      selectedVisitors: [null, {
        updateOn: 'blur'
      }]
    }, {
      validators: [
        // this.coordinatesWithinBoundsValidator,
        // this.displayNameValidator
      ]
    });

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formValue.emit(this.form);
      this.cdr.detectChanges();
    });

    // When the user chooses/changes the activity, we need to retrieve the products related
    this.form.get('selectedActivity').valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(async (activity) => {
      this.setFormProduct(activity);
    });
    
    // When the user chooses their product, we need to then retrieve the productDates
    this.setFormProductDates();

    // When the user selects their date, then we can provide the passes available
    this.setFormPassesAvailable();
  }

  async setFormProduct(activity) {
    // When the user chooses/changes the activity, we need to retrieve the products related
    if (!activity) return;
    const request = ++this.activityRequest;
    ++this.productDatesRequest;
    this.invalidateAvailability();
    this.loadingDates = false;
    this.datesLoadFailed = false;
    this.availableDates = {};
    this.form.get('selectedProduct').setValue(null, { emitEvent: false });
    this.form.get('selectedDate').setValue(null, { emitEvent: false });
    
    const pk = activity.split('#')[0];
    const sk = activity.split('#')[1];
    const collectionId = pk.split('::')[1];
    const activityType = sk.split('::')[0];
    const activityId = sk.split('::')[1];

    this.selectedCollectionId = collectionId;
    this.selectedActivityType = activityType;
    this.selectedActivityId = activityId;
    const selectedActivity = this.availableActivities.find(a => a.value === activity);
    this.selectedActivityName = selectedActivity?.display || '';
    this.selectedActivitySubType = selectedActivity?.meta?.activitySubType ?? null;

    this.loadingProducts = true;
    this.availableProducts = [];
    this.passValidity = null;

    // The related product pk/sk is made up from the selected activity's pk/sk
    const relatedProducts = (await this.productService.getProductsByActivity(collectionId, activityType, activityId))?.items || [];
    if (this.destroyRef.destroyed || request !== this.activityRequest) return;
    this.loadingProducts = false;

    // Populate the "Pass type" dropdown with each product
    this.availableProducts = relatedProducts
        .filter(product => product?.productId !== undefined && product?.productId !== null)
        .map(product => {
          return {
            display: product?.displayName,
            value: `${product?.pk}#${product?.productId}`
          }
        });
  }

  setFormProductDates() {
    this.form.get('selectedProduct').valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((product) => {
      if (!product) {
        ++this.productDatesRequest;
        this.loadingDates = false;
        this.datesLoadFailed = false;
        this.availableDates = {};
        this.passValidity = null;
        this.form.get('selectedDate').setValue(null, { emitEvent: false });
        this.invalidateAvailability();
        return;
      }
      this.selectedProductName = this.availableProducts.find(p => p.value === product)?.display || '';
      this.loadProductDates(product);
    });
  }

  private async loadProductDates(product: string) {
    const request = ++this.productDatesRequest;
    this.invalidateAvailability();
    const pk = product.split('#')[0];
    const selectedProductId = product.split('#')[1];
    const collectionId = pk.split('::')[1];
    const activityType = pk.split('::')[2];
    const activityId = pk.split('::')[3];
    const productId = selectedProductId || null;

    this.loadingDates = true;
    this.datesLoadFailed = false;
    this.availableDates = {};
    this.passValidity = null;
    this.form.get('selectedDate').setValue(null, { emitEvent: false });
    this.form.get('selectedVisitors').setValue(null, { emitEvent: false });

    // The productDates are found using the product's pk/sk and providing the available dates
    // which is between now and two days in the future
    const productDatesResult = await this.productDateService.getProductDates(
      collectionId,
      activityType,
      activityId,
      productId,
      DateTime.now().toISODate(),
      DateTime.now().plus({ days: 2 }).toISODate()
    );
    if (this.destroyRef.destroyed || request !== this.productDatesRequest || this.form.get('selectedProduct').value !== product) return;
    this.loadingDates = false;

    // The service returns null only when the request itself failed. Bail out here rather
    // than falling through to the empty-array path, which would report a sold-out facility.
    if (productDatesResult === null) {
      this.datesLoadFailed = true;
      this.availableDates = {};
      return;
    }
    this.datesLoadFailed = false;

    // API returns a plain array of ProductDates; fall back to `.items` for any legacy wrapped shape
    const dates = Array.isArray(productDatesResult) ? productDatesResult : (productDatesResult?.items || []);

    // Convert this.availableDates to an object with sk: {availableDate}
    const availableDatesMap = {}
    for (const date of dates) {
      availableDatesMap[date.sk] = date;
    }

    this.availableDates = availableDatesMap;
    this.updatePassValidity(this.form.get('selectedDate').value);
  }

  private updatePassValidity(date?: string | null) {
    const productDate = (date && this.availableDates[date]) || Object.values(this.availableDates)[0];
    const context = productDate?.reservationContext;
    const start = BookingUtils.formatParkTime(context?.checkInAnchor ?? context?.temporalAnchors?.checkInTime);
    const end = BookingUtils.formatParkTime(context?.checkOutAnchor ?? context?.temporalAnchors?.checkOutTime);
    this.passValidity = start && end ? `Valid ${start} – ${end}` : null;
  }

  setFormPassesAvailable() {
    this.form.get('selectedDate').valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((date) => {
      if (!date) {
        this.invalidateAvailability();
        return;
      }
      this.loadPassesAvailable(date);
    });
  }

  private invalidateAvailability(): void {
    ++this.availabilityRequest;
    clearTimeout(this.windowTimer);
    this.availabilityState = { status: 'idle' };
    this.selectedDateStr = '';
    this.waitingRoomActive = false;
    this.form.get('selectedVisitors').setValue(null, { emitEvent: false });
  }

  private dateString(date: any): string {
    return typeof date === 'string' ? date : (date?.toISODate ? date.toISODate() : String(date));
  }

  private isCurrentAvailability(request: number, selection: AvailabilitySelection): boolean {
    return !this.destroyRef.destroyed && request === this.availabilityRequest &&
      selection.collectionId === (this.selectedCollectionId || '') &&
      selection.activityType === (this.selectedActivityType || '') &&
      selection.activityId === (this.selectedActivityId || '') &&
      selection.productId === this.getProductIdFromForm() &&
      selection.date === this.dateString(this.form.get('selectedDate').value);
  }

  public async retryAvailability(): Promise<void> {
    if (!this.isLoggedIn || !this.emailVerificationLoaded || !this.emailVerified || this.loadingPasses || this.loadingDates || this.loadingProducts) return;
    if (!this.datesLoadFailed && this.passStatus !== 'error') return;
    const product = this.form.get('selectedProduct').value;
    const date = this.form.get('selectedDate').value;
    if (!product) return;
    // Recheck both policy/context and inventory; either may have caused the error.
    const reload = this.loadProductDates(product);
    const datesRequest = this.productDatesRequest;
    const availabilityRequest = this.availabilityRequest;
    await reload;
    if (this.destroyRef.destroyed || datesRequest !== this.productDatesRequest ||
        availabilityRequest !== this.availabilityRequest || this.form.get('selectedProduct').value !== product || this.datesLoadFailed) return;
    if (date && this.availableDates[this.dateString(date)]) {
      this.form.get('selectedDate').setValue(date, { emitEvent: false });
      await this.loadPassesAvailable(date, true);
    }
  }

  private async loadPassesAvailable(date: any, refresh = false): Promise<void> {
    const request = ++this.availabilityRequest;
    clearTimeout(this.windowTimer);
    // Capture every input before awaiting: no response may change a newer selection.
    const selection: AvailabilitySelection = {
      collectionId: this.selectedCollectionId || '',
      activityType: this.selectedActivityType || '',
      activityId: this.selectedActivityId || '',
      productId: this.getProductIdFromForm(),
      date: this.dateString(date)
    };
    const selectedDate = this.availableDates[selection.date];
    const context = selectedDate?.reservationContext;
    const cachedInventory = selectedDate?.inventoryPool;
    const isParking = this.selectedActivitySubType === 'vehicleParking';
    this.selectedDateStr = selection.date;
    this.waitingRoomActive = false;
    this.availabilityState = { status: 'loading', selection };
    this.form.get('selectedVisitors').setValue(null, { emitEvent: false });
    this.updatePassValidity(selection.date);

    let waitingRoomActive = false;
    if (selection.collectionId && selection.activityType && selection.activityId) {
      try {
        const res = await lastValueFrom(this.apiService.get(
          `activities/${selection.collectionId}`,
          { activityType: selection.activityType, activityId: selection.activityId, startDate: selection.date }
        ));
        waitingRoomActive = res?.['data']?.waitingRoomActive === true;
      } catch {
        // Booking API continues to enforce waiting-room admission server-side.
      }
      if (!this.isCurrentAvailability(request, selection)) return;
    }

    let inventory = cachedInventory;
    if (refresh || !cachedInventory) {
      try {
        inventory = await this.inventoryPoolService.getInventoryPool(
          selection.collectionId, selection.activityType, selection.activityId, selection.productId, selection.date
        );
      } catch {
        inventory = null;
      }
    }
    if (!this.isCurrentAvailability(request, selection)) return;

    if (refresh && cachedInventory) {
      // Do not revive an invalid embedded snapshot when the visitor returns to this date.
      this.availableDates[selection.date] = { ...selectedDate, inventoryPool: undefined };
    }
    this.waitingRoomActive = waitingRoomActive;
    this.availabilityState = evaluateAvailability(selection, inventory, context, this.serverTime.now(), isParking);
    if (this.passesAvailable && isParking) {
      this.form.get('selectedVisitors').setValue('1', { emitEvent: false });
    }
    if (this.availabilityState.status === 'not-open-yet') {
      this.scheduleWindowRecheck(this.availabilityState.opensAt, request, selection);
    }
    this.cdr.detectChanges();
  }

  public onCalendarDisplayChange() {
    this.cdr.detectChanges();
  }

  private getProductIdFromForm(): string {
    const selectedProductValue = this.form.get('selectedProduct').value;
    if (!selectedProductValue) return '';
    const productId = selectedProductValue.split('#')[1];
    return productId || '';
  }


  // Get the correct icon for the activity type using Constants.activityTypes
  getIcon(activityType, activitySubType) {
    return Constants.activityTypes[activityType]?.subTypes[activitySubType]?.iconClass || 'fa-solid fa-person-hiking';
  }

  // Waiting room admission returns the user to this page fresh (#259) — carry the
  // in-progress selections as query params so ngOnInit can restore them.
  private buildReturnUrlWithSelections(): string {
    const params = new URLSearchParams();
    const activity = this.form.get('selectedActivity').value;
    const product = this.form.get('selectedProduct').value;
    const date = this.selectedDateStr || this.form.get('selectedDate').value;
    const visitors = this.form.get('selectedVisitors').value;
    if (activity) params.set('activity', activity);
    if (product) params.set('product', product);
    if (date) params.set('date', date);
    if (visitors) params.set('visitors', visitors);

    const query = params.toString();
    // router.url excludes <base href>, and the waiting room assigns this value to
    // window.location.href verbatim — resolve it so it survives the /dayuse/ mount.
    const basePath = this.router.url.split('?')[0].replace(/^\//, '');
    return new URL(query ? `${basePath}?${query}` : basePath, document.baseURI).toString();
  }

  get holdRetryAt(): DateTime | null {
    return this.holdRetry?.key === this.holdSelectionKey() ? this.holdRetry.retryAt : null;
  }

  onHoldRetryElapsed(): void {
    this.holdRetry = null;
    this.cdr.detectChanges();
  }

  private holdSelectionKey(): string {
    return `${this.getProductIdFromForm()}#${this.selectedDateStr || this.form?.get('selectedDate')?.value}`;
  }

  async submit(): Promise<void> {
    if (!this.passesAvailable || !this.isLoggedIn || !this.emailVerificationLoaded || !this.emailVerified || this.loadingDates || this.loadingProducts) return;
    const quantity = String(this.form.get('selectedVisitors').value);
    if (!this.availableVisitorsAllowed.some(option => option.value === quantity)) return;
    if (this.holdRetryAt) return;

    // Gate the booking action when Mode 2 is active and user lacks admission
    if (this.waitingRoomService.mode2Active() &&
        !this.waitingRoomService.hasValidAdmission('MODE2#global#1', '')) {
      const today = new Date().toISOString().slice(0, 10);
      window.location.href = this.waitingRoomService.buildWaitingRoomUrl(
        'MODE2', 'global', '1', today, this.buildReturnUrlWithSelections()
      );
      return;
    }

    const date = this.selectedDateStr || this.form.get('selectedDate').value;

    // Check Mode 1 (facility-specific) waiting room — status cached when date was selected
    if (this.waitingRoomActive && this.selectedCollectionId && this.selectedActivityType && this.selectedActivityId && date) {
      const facilityKey = `${this.selectedCollectionId}#${this.selectedActivityType}#${this.selectedActivityId}`;
      if (!this.waitingRoomService.hasValidAdmission(facilityKey, date)) {
        window.location.href = this.waitingRoomService.buildWaitingRoomUrl(
          this.selectedCollectionId,
          this.selectedActivityType,
          this.selectedActivityId,
          date,
          this.buildReturnUrlWithSelections(),
          this.facility?.displayName || ''
        );
        return;
      }
    }
    const visitors = Number(this.form.get('selectedVisitors').value);
    const selectedProductValue = this.form.get('selectedProduct').value;
    const selectedProductName = this.availableProducts.find(product => product.value === selectedProductValue)?.display || '';
    
    // Extract productId from the selected product (format: "product::collectionId::activityType::activityId#productId")
    let productId = null;
    if (selectedProductValue) {
      const selectedProductId = selectedProductValue.split('#')[1];
      productId = selectedProductId || null;
    }

    if (!productId) {
      this.toastService.addMessage('Please select a pass type', 'Error', ToastTypes.ERROR);
      return;
    }

    const existingCartItem = this.cartService.items()[0];
    if (existingCartItem) {
      const proceed = await this.confirmReplaceCart(existingCartItem);
      if (!proceed) return;
      // Release the old hold before creating the new booking — otherwise the
      // API rejects a re-book of the same pass/date. (Ref #650.)
      await this.cartService.releaseCartItem(existingCartItem);
      // Drop the released item now; a failed new hold must leave the cart empty.
      this.cartService.removeFromCart(existingCartItem.id);
    }
    

    // Create booking immediately to reserve the inventory
    try {
      const bookingData = {
        startDate: date,
        endDate: date,
        productId: productId,
        quantity: visitors,
        collectionId: this.selectedCollectionId || '',
        activityId: this.selectedActivityId || '',
        activityType: this.selectedActivityType || '',
        facilityDisplayName: this.facility?.displayName || '',
        geozoneDisplayName: this.geozone?.displayName || '',
      };

      const booking = await this.bookingService.createBooking(
        bookingData,
        this.selectedCollectionId || '',
        this.selectedActivityType || '',
        this.selectedActivityId || '',
        date
      );

      const bookingId = booking?.bookingId || booking?.globalId || booking?.booking?.[0]?.data?.globalId || null;
      const sessionId = booking?.sessionId || booking?.booking?.[0]?.data?.sessionId || null;

      if (!bookingId || !sessionId) {
        throw new Error('Booking creation failed, no booking ID or session ID returned.');
      }

      // Add to cart with booking details for inventory reservation
      const selectedProductDate = this.availableDates[date];

      const cartItem: CartItem = {
        id: '',
        collectionId: this.selectedCollectionId || '',
        activityType: this.selectedActivityType || '',
        activitySubType: this.selectedActivitySubType || '',
        activityId: this.selectedActivityId || '',
        productId: productId,
        quantity: visitors,
        activityName: this.selectedActivityName || this.facility?.displayName || '',
        productName: selectedProductName,
        geozoneName: this.facility?.displayName || '',
        dateRange: [date, date],
        startDate: date,
        endDate: date,
        namedOccupant: {
          firstName: '',
          lastName: ''
        },
        occupants: { totalAdult: visitors, totalSenior: 0, totalYouth: 0, totalChild: 0 },
        feeInformation: { registrationFees: 0, transactionFees: 0, tax: 0, total: 0 },
        detailsStepCompleted: false,
        visitorDetailsStepCompleted: false,
        equipmentStepCompleted: false,
        paymentStepCompleted: false,
        areAllStepsCompleted: false,
        checkInAnchor: selectedProductDate?.reservationContext?.checkInAnchor ?? selectedProductDate?.reservationContext?.temporalAnchors?.checkInTime,
        checkOutAnchor: selectedProductDate?.reservationContext?.checkOutAnchor ?? selectedProductDate?.reservationContext?.temporalAnchors?.checkOutTime,
        bookingId: bookingId,
        sessionId: sessionId,
        sessionInitTime: booking?.sessionInitTime,
        sessionExpiry: booking?.sessionExpiry,
        holdLimits: booking?.holdLimits,
        vehicleInformation: [
          {
            licensePlate: '',
            licensePlateRegistrationRegion: '',
          }
        ],
      };

      this.cartService.addToCart(cartItem);
      this.toastService.addMessage('Item added to cart', 'Success', ToastTypes.SUCCESS);
      this.cdr.detectChanges();
      
      // Redirect to cart on success
      await this.router.navigate(['/cart']);
    } catch (error: any) {
      console.error('Error creating booking:', error);
      const retryAt = parseHoldRetryAt(error);
      if (retryAt && retryAt > this.serverTime.now()) {
        this.holdRetry = { key: this.holdSelectionKey(), retryAt };
        this.cdr.detectChanges();
        return;
      }
      // API returns error text under `msg`; walk the usual shapes before
      // falling back to a generic message.
      const errorMessage =
        error?.error?.msg ||
        error?.error?.error ||
        error?.error?.Message ||
        error?.error?.message ||
        error?.message ||
        'Failed to create booking. Please try again.';
      this.toastService.addMessage(errorMessage, 'Error', ToastTypes.ERROR);
    }
  }

  // Prompt the user before replacing an existing cart item. Resolves true if they
  // confirm, false if they cancel or dismiss. Single-item cart semantics — see
  // CartService.addToCart.
  private confirmReplaceCart(existing: CartItem): Promise<boolean> {
    return new Promise(resolve => {
      const description = existing.productName
        ? `${existing.productName} (${existing.startDate})`
        : `your pending booking on ${existing.startDate}`;
      const modalRef = this.modalService.show(ConfirmationModalComponent, {
        initialState: {
          title: 'Replace pending booking?',
          body: `Your cart already has ${description}. Adding this booking will replace it.`,
          notes: holdReleaseNotes(existing),
          confirmText: 'Replace',
          cancelText: 'Cancel',
          confirmClass: 'btn btn-primary',
          cancelClass: 'btn btn-outline-secondary',
        },
      });
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        modalRef.hide();
        resolve(value);
      };
      modalRef.content?.confirmButton.subscribe(() => settle(true));
      modalRef.content?.cancelButton.subscribe(() => settle(false));
      modalRef.onHide?.subscribe(() => settle(false));
    });
  }

  // Method to check if the user's email is verified
  async checkUserEmailVerification() {
    this.emailVerificationLoaded = false;
    this.emailVerified = await this.authService.checkEmailVerification();
    this.emailVerificationLoaded = true;
    this.cdr.detectChanges();
  }

  onEmailVerified() {
    this.emailVerified = true;
    this.cdr.detectChanges();
  }

  ngAfterViewInit(): void {
    // A scroll listener, not an IntersectionObserver: at the page bottom the last
    // section's top never reaches the 15% line, so no threshold fires there.
    // Outside the zone, or every scroll frame runs app-wide change detection.
    this.sectionEls = Array.from(document.querySelectorAll('.scroll-anchor')) as HTMLElement[];
    if (!this.sectionEls.length) return;
    this.zone.runOutsideAngular(() =>
      this.scrollEvents.forEach(e => window.addEventListener(e, this.onScroll, { passive: true }))
    );
    this.updateActiveSection();
  }

  private onScroll = (): void => this.updateActiveSection();

  private updateActiveSection(): void {
    const vh = window.innerHeight;
    // The last section whose top has passed the 15% line, or the last section
    // once the page has bottomed out and nothing more can reach that line. The
    // 4px slack absorbs fractional scroll offsets at non-100% browser zoom. A page
    // too short to scroll is "at the bottom" at rest, so it doesn't count.
    const scrollHeight = document.documentElement.scrollHeight;
    const atBottom = scrollHeight > vh && window.scrollY + vh >= scrollHeight - 4;
    const passed = this.sectionEls.filter(s => s.getBoundingClientRect().top <= vh * 0.15 + 1);
    const active = (atBottom ? this.sectionEls.at(-1) : passed.at(-1) ?? this.sectionEls[0])!.id;
    if (active !== this.activeSection) {
      this.activeSection = active;
      this.cdr.detectChanges();
    }
  }

  scrollToSection(event: Event, id: string): void {
    event.preventDefault();
    this.activeSection = id;
    const el = document.getElementById(id);
    if (!el) return;
    // scrollIntoView and smooth scrolling both stall in this layout, so jump
    // the window directly.
    const top = el.getBoundingClientRect().top + window.scrollY - 24;
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  }

  // Short steps rather than one long timeout: timers pause while a device sleeps.
  private scheduleWindowRecheck(opensAt: DateTime, request: number, selection: AvailabilitySelection): void {
    clearTimeout(this.windowTimer);
    if (!this.isCurrentAvailability(request, selection)) return;
    const msUntilOpen = opensAt.toMillis() - this.serverTime.now().toMillis();
    if (msUntilOpen <= 0) {
      this.loadPassesAvailable(selection.date);
      return;
    }
    this.windowTimer = setTimeout(() => this.scheduleWindowRecheck(opensAt, request, selection), Math.min(msUntilOpen + 250, 60_000));
  }

  ngOnDestroy(): void {
    ++this.activityRequest;
    ++this.productDatesRequest;
    ++this.availabilityRequest;
    this.scrollEvents.forEach(e => window.removeEventListener(e, this.onScroll));
    clearTimeout(this.windowTimer);
  }
}

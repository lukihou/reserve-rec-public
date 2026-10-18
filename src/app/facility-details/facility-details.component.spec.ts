import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Component, Input, Signal } from '@angular/core';

import { FacilityDetailsComponent } from './facility-details.component';
import { SearchMapComponent } from '../search-map/search-map.component';

@Component({
  selector: 'app-search-map',
  template: '',
  standalone: true
})
class MockSearchMapComponent {
  @Input() _dataSignal: Signal<any[]>;
  @Input() displayGeozones = false;
}
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfigService } from '../services/config.service';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideToastr } from 'ngx-toastr';
import { BsModalService } from 'ngx-bootstrap/modal';
import { Title } from '@angular/platform-browser';
import { ServerTimeService } from '../services/server-time.service';
import { Router } from '@angular/router';
import { from, of } from 'rxjs';
import { DateTime } from 'luxon';
import * as bootstrap from 'bootstrap';
import { BookingService } from '../services/booking.service';
import { CartItem, CartService } from '../services/cart.service';
import { ToastService } from '../services/toast.service';
import { ProductDateService } from '../services/product-date.service';
import { InventoryPoolService } from '../services/inventory-pool.service';
import { ApiService } from '../services/api.service';
import { ProductService } from '../services/product.service';
import { AvailabilitySelection } from './availability-state';

describe('FacilityDetailsComponent', () => {
  let component: FacilityDetailsComponent;
  let fixture: ComponentFixture<FacilityDetailsComponent>;
  let bootstrapDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    // The app supplies this global script; populated ngds dropdowns need it in the fixture too.
    bootstrapDescriptor = Object.getOwnPropertyDescriptor(window, 'bootstrap');
    Object.defineProperty(window, 'bootstrap', { configurable: true, writable: true, value: bootstrap });
  });
  afterAll(() => {
    if (bootstrapDescriptor) Object.defineProperty(window, 'bootstrap', bootstrapDescriptor);
    else delete (window as any).bootstrap;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FacilityDetailsComponent],
      providers: [
        ConfigService,
        provideRouter([{ path: 'facility/:orcs/:facilityType/:identifier', component: FacilityDetailsComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideToastr(),
        { provide: BsModalService, useValue: { show: () => ({}) } },
        {
          provide: ActivatedRoute,
          useValue: {
            root: {
              children: []
            },
            snapshot: {
              queryParamMap: convertToParamMap({}),
              data: {
                facility: {
                  displayName: 'Joffre Lakes Park',
                  geozones: [],
                  isOpen: true,
                  activities: []
                }
              }
            }
          }
        }
      ]
    })
      .overrideComponent(FacilityDetailsComponent, {
        remove: { imports: [SearchMapComponent] },
        add: { imports: [MockSearchMapComponent] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(FacilityDetailsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Scrolled to the bottom, the trailing sections can never reach the 15% line,
  // so the "On this page" list used to stay stuck on an earlier section.
  it('highlights the last section once the page is scrolled to the bottom', () => {
    const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'scrollY', { value: 1e6, configurable: true });

    const last = document.createElement('div');
    last.id = 'last-section';
    last.className = 'scroll-anchor';
    document.body.appendChild(last);

    component.ngAfterViewInit();

    expect(component.activeSection).toBe('last-section');

    component.ngOnDestroy();
    last.remove();
    if (scrollY) Object.defineProperty(window, 'scrollY', scrollY);
  });

  // A page too short to scroll is "at the bottom" at rest; that must not
  // highlight the last section before the visitor has scrolled at all.
  it('does not highlight the last section on a page too short to scroll', () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: window.innerHeight, configurable: true });

    const last = document.createElement('div');
    last.id = 'last-section';
    last.className = 'scroll-anchor';
    last.style.cssText = 'position: fixed; top: 50vh;';
    document.body.appendChild(last);

    component.ngAfterViewInit();

    expect(component.activeSection).not.toBe('last-section');

    component.ngOnDestroy();
    last.remove();
    delete (document.documentElement as any).scrollHeight;
  });

  it('sets the browser title to the facility name', () => {
    expect(TestBed.inject(Title).getTitle()).toBe('Joffre Lakes Park | BC Parks');
  });

  // The API answers a missing facility with 200 and a null body. The constructor
  // used to dereference it unguarded, which threw and left Angular rendering an
  // entirely blank page instead of anything the user could act on.
  it('does not throw when the resolver supplies no facility', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FacilityDetailsComponent],
      providers: [
        ConfigService,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideToastr(),
        { provide: BsModalService, useValue: { show: () => ({}) } },
        {
          provide: ActivatedRoute,
          useValue: { root: { children: [] }, snapshot: { data: { facility: null } } }
        }
      ]
    }).overrideComponent(FacilityDetailsComponent, {
      remove: { imports: [SearchMapComponent] },
      add: { imports: [MockSearchMapComponent] }
    });

    const nullFixture = TestBed.createComponent(FacilityDetailsComponent);

    expect(nullFixture.componentInstance.facilityLoadFailed).toBeTrue();
    expect(nullFixture.componentInstance.facility).toBeNull();
    expect(nullFixture.componentInstance.geozone).toBeNull();
    expect(nullFixture.componentInstance.relatedActivities).toEqual([]);
  });

  it('renders an error state rather than an empty page', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FacilityDetailsComponent],
      providers: [
        ConfigService,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideToastr(),
        { provide: BsModalService, useValue: { show: () => ({}) } },
        {
          provide: ActivatedRoute,
          useValue: { root: { children: [] }, snapshot: { data: { facility: null } } }
        }
      ]
    }).overrideComponent(FacilityDetailsComponent, {
      remove: { imports: [SearchMapComponent] },
      add: { imports: [MockSearchMapComponent] }
    });

    const nullFixture = TestBed.createComponent(FacilityDetailsComponent);
    nullFixture.detectChanges();
    const el: HTMLElement = nullFixture.nativeElement;

    expect(el.querySelector('[role="alert"]')?.textContent)
      .toContain('could not load this day-use area');
    // The booking form must not be offered for a facility that never loaded.
    expect(el.querySelector('form')).toBeNull();
  });

  describe('availability state', () => {
    const date = DateTime.now().toISODate();
    const nextDate = DateTime.now().plus({ days: 1 }).toISODate();
    const product = 'product::c1::dayuse::a1#p1';
    let inventory: jasmine.Spy;
    let api: jasmine.Spy;
    const el = (): HTMLElement => fixture.nativeElement;
    const board = () => el().querySelector('#request-a-pass');
    const bookButton = () => Array.from(board().querySelectorAll('button')).find(b => b.textContent?.includes('Book day-use pass'));
    const productDate = () => ({
      reservationContext: {
        minDailyInventory: 1, maxDailyInventory: 4,
        temporalWindows: { reservationWindow: { open: Date.now() - 1000, close: Date.now() + 86400000 } }
      }
    });
    function deferred<T = any>() {
      let resolve: (value: T) => void;
      const promise = new Promise<T>(done => resolve = done);
      return { promise, resolve: (value: T) => resolve(value) };
    }
    async function load(value: any, cached = false) {
      if (cached) component.availableDates[date].inventoryPool = value;
      else inventory.and.resolveTo(value);
      await (component as any).loadPassesAvailable(date);
      fixture.detectChanges();
    }

    beforeEach(async () => {
      component.isLoggedIn = true;
      component.emailVerificationLoaded = true;
      component.emailVerified = true;
      component.availableProducts = [{ display: 'Trail pass', value: product }];
      component.form.get('selectedProduct').setValue(product, { emitEvent: false });
      component.form.get('selectedDate').setValue(date, { emitEvent: false });
      component.availableDates = { [date]: productDate(), [nextDate]: productDate() };
      Object.assign(component as any, { selectedCollectionId: 'c1', selectedActivityType: 'dayuse', selectedActivityId: 'a1' });
      api = spyOn(TestBed.inject(ApiService), 'get').and.returnValue(of({ data: { waitingRoomActive: false } }));
      spyOn(component as any, 'loadProductDates').and.resolveTo();
      inventory = spyOn(TestBed.inject(InventoryPoolService), 'getInventoryPool').and.resolveTo(null);
      fixture.detectChanges();
      await fixture.whenStable();
      inventory.calls.reset();
      component.availabilityState = { status: 'idle' };
    });
    afterEach(() => fixture.destroy());

    it('starts idle without claiming there are no passes', () => {
      fixture.detectChanges();
      expect(component.passStatus).toBe('idle');
      expect(board().textContent).toContain('Select a pass type and date');
      expect(board().textContent).not.toContain('No passes available');
      expect(component.passesAvailable).toBeFalse();
    });

    it('renders loading without claiming sold-out or no pass required', async () => {
      const pending = deferred();
      inventory.and.returnValue(pending.promise);
      const loading = (component as any).loadPassesAvailable(date);
      await Promise.resolve();
      fixture.detectChanges();
      expect(board().textContent).toContain('Checking availability');
      expect(board().textContent).not.toContain('No passes available');
      expect(board().textContent).not.toContain('passes not required');
      expect(component.availableVisitorsAllowed).toEqual([]);
      expect(bookButton()).toBeUndefined();
      pending.resolve({ isOpen: true, available: 3 });
      await loading;
    });

    it('renders a lookup error and offers no booking', async () => {
      await load(null);
      expect(board().querySelector('[role="alert"]')?.textContent).toContain('Availability unavailable — try again');
      expect(component.passStatus).toBe('error');
      expect(component.passesAvailable).toBeFalse();
      expect(component.loadingPasses).toBeFalse();
      expect(component.availableVisitorsAllowed).toEqual([]);
      expect(component.form.get('selectedVisitors').value).toBeNull();
      expect(board().textContent).not.toContain('passes not required');
      expect(bookButton()).toBeUndefined();
    });

    it('preserves verification after a denied lookup', async () => {
      component.emailVerified = false;
      await load(null);
      expect(board().querySelector('app-account-verification')).not.toBeNull();
      expect(board().textContent).not.toContain('Availability unavailable');
      expect(bookButton()).toBeUndefined();
    });

    it('does not offer booking before verification has loaded', async () => {
      component.emailVerificationLoaded = false;
      await load({ isOpen: true, available: 3 });
      expect(board().textContent).toContain('Checking your account');
      expect(bookButton()).toBeUndefined();
    });

    it('retries the current date through the visible button and bypasses invalid cached inventory', async () => {
      await load({ isOpen: true, available: null }, true);
      expect(inventory).not.toHaveBeenCalled();
      const pending = deferred();
      inventory.and.returnValue(pending.promise);
      (component as any).loadProductDates.and.callThrough();
      spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.resolveTo([
        { sk: date, ...productDate(), inventoryPool: { isOpen: true, available: null } },
        { sk: nextDate, ...productDate() }
      ]);
      const retry = Array.from(board().querySelectorAll('button')).find(b => b.textContent?.trim() === 'Try again');
      retry.click();
      component.retryAvailability();
      await new Promise(resolve => setTimeout(resolve, 0));
      fixture.detectChanges();
      expect(inventory).toHaveBeenCalledOnceWith('c1', 'dayuse', 'a1', 'p1', date);
      expect(component.loadingPasses).toBeTrue();
      pending.resolve({ isOpen: true, available: 3 });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.passStatus).toBe('available');
      expect(component.availableVisitorsAllowed.map(v => v.value)).toEqual(['1', '2', '3']);
      component.form.get('selectedVisitors').setValue('2', { emitEvent: false });
      fixture.detectChanges();
      expect(bookButton()?.disabled).toBeFalse();
      inventory.and.resolveTo({ isOpen: true, available: 2 });
      component.form.get('selectedDate').setValue(nextDate, { emitEvent: false });
      await (component as any).loadPassesAvailable(nextDate);
      component.form.get('selectedDate').setValue(date, { emitEvent: false });
      await (component as any).loadPassesAvailable(date);
      expect(component.passStatus).toBe('available');
      expect(component.availableVisitorsAllowed.map(v => v.value)).toEqual(['1', '2']);
    });

    for (const test of [
      { label: 'no pass required', pool: { isOpen: false, available: null }, copy: 'Day use passes not required for this day.', status: 'not-required' },
      { label: 'closed', pool: { isOpen: false, available: null, closureStatus: true }, copy: 'This park area is closed', status: 'closed' },
      { label: 'sold out', pool: { isOpen: true, available: 0 }, copy: 'have been fully reserved', status: 'sold-out' }
    ]) {
      it(`preserves the ${test.label} result`, async () => {
        await load(test.pool);
        expect(board().textContent).toContain(test.copy);
        expect(component.passStatus).toBe(test.status);
        expect(component.passesAvailable).toBeFalse();
        expect(component.availableVisitorsAllowed).toEqual([]);
      });
    }

    it('never auto-selects a vehicle pass on unknown inventory', async () => {
      component.selectedActivitySubType = 'vehicleParking';
      await load(null);
      expect(component.form.get('selectedVisitors').value).toBeNull();
      expect(component.availableVisitorsAllowed).toEqual([]);
      expect(component.passesAvailable).toBeFalse();
    });

    for (const test of [
      { label: 'failure', old: null, current: { isOpen: true, available: 3 }, status: 'available' },
      { label: 'success', old: { isOpen: true, available: 3 }, current: null, status: 'error' },
      { label: 'no-pass-required result', old: { isOpen: false, available: null }, current: { isOpen: true, available: 3 }, status: 'available' }
    ]) {
      it(`ignores an old ${test.label} after the latest date completes`, async () => {
        const older = deferred();
        inventory.and.callFake((_c, _t, _a, _p, day) => day === date ? older.promise : Promise.resolve(test.current));
        const first = (component as any).loadPassesAvailable(date);
        await Promise.resolve();
        component.form.get('selectedDate').setValue(nextDate, { emitEvent: false });
        await (component as any).loadPassesAvailable(nextDate);
        older.resolve(test.old);
        await first;
        fixture.detectChanges();
        expect(component.passStatus).toBe(test.status);
        expect(component.passesAvailable).toBe(test.status === 'available');
        expect(component.availableVisitorsAllowed.length).toBe(test.status === 'available' ? 3 : 0);
        expect(component.form.get('selectedDate').value).toBe(nextDate);
        expect(board().textContent).not.toContain('passes not required');
      });
    }

    it('does not issue inventory for an obsolete waiting-room request', async () => {
      const waiting = deferred();
      api.and.returnValues(from(waiting.promise), of({ data: { waitingRoomActive: false } }));
      inventory.and.resolveTo({ isOpen: true, available: 3 });
      const first = (component as any).loadPassesAvailable(date);
      component.form.get('selectedDate').setValue(nextDate, { emitEvent: false });
      await (component as any).loadPassesAvailable(nextDate);
      waiting.resolve({ data: { waitingRoomActive: true } });
      await first;
      expect(inventory).toHaveBeenCalledOnceWith('c1', 'dayuse', 'a1', 'p1', nextDate);
      expect((component as any).waitingRoomActive).toBeFalse();
    });

    it('invalidates pending inventory when the product changes', async () => {
      const older = deferred();
      inventory.and.returnValue(older.promise);
      const first = (component as any).loadPassesAvailable(date);
      await Promise.resolve();
      const dates = deferred();
      spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.returnValue(dates.promise);
      (component as any).loadProductDates.and.callThrough();
      const nextProduct = 'product::c1::dayuse::a1#p2';
      component.form.get('selectedProduct').setValue(nextProduct, { emitEvent: false });
      const second = (component as any).loadProductDates(nextProduct);
      older.resolve({ isOpen: true, available: 3 });
      await first;
      expect(component.passStatus).toBe('idle');
      expect(component.passesAvailable).toBeFalse();
      expect(component.loadingDates).toBeTrue();
      dates.resolve([{ sk: nextDate, ...productDate() }]);
      await second;
    });

    it('ignores old product dates after switching products', async () => {
      const older = deferred();
      const newer = deferred();
      spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.returnValues(older.promise, newer.promise);
      (component as any).loadProductDates.and.callThrough();
      const first = (component as any).loadProductDates(product);
      const nextProduct = 'product::c1::dayuse::a1#p2';
      component.form.get('selectedProduct').setValue(nextProduct, { emitEvent: false });
      const second = (component as any).loadProductDates(nextProduct);
      newer.resolve([{ sk: nextDate, ...productDate() }]);
      await second;
      older.resolve([{ sk: date, ...productDate() }]);
      await first;
      expect(Object.keys(component.availableDates)).toEqual([nextDate]);
      expect(component.loadingDates).toBeFalse();
    });

    it('ignores old products after switching activities', async () => {
      const older = deferred();
      const newer = deferred();
      spyOn(TestBed.inject(ProductService), 'getProductsByActivity').and.returnValues(older.promise, newer.promise);
      const first = component.setFormProduct('collection::c1#dayuse::a1');
      const second = component.setFormProduct('collection::c2#dayuse::a2');
      newer.resolve({ items: [{ pk: 'product::c2::dayuse::a2', productId: 'p2', displayName: 'New pass' }] });
      await second;
      older.resolve({ items: [{ pk: 'product::c1::dayuse::a1', productId: 'p1', displayName: 'Old pass' }] });
      await first;
      expect(component.availableProducts.map(p => p.display)).toEqual(['New pass']);
    });

    it('ignores pending inventory after destruction', async () => {
      const pending = deferred();
      inventory.and.returnValue(pending.promise);
      const first = (component as any).loadPassesAvailable(date);
      await Promise.resolve();
      fixture.destroy();
      const detect = spyOn((component as any).cdr, 'detectChanges');
      pending.resolve({ isOpen: true, available: 3 });
      await first;
      expect(detect).not.toHaveBeenCalled();
      expect(component.passesAvailable).toBeFalse();
    });

    it('never creates a booking from the error state', async () => {
      const create = spyOn(TestBed.inject(BookingService), 'createBooking');
      await load(null);
      await component.submit();
      expect(create).not.toHaveBeenCalled();
    });

    it('refreshes broken reservation context as well as inventory on retry', async () => {
      component.availableDates[date].reservationContext = {};
      await load({ isOpen: true, available: 3 });
      expect(component.passStatus).toBe('error');
      (component as any).loadProductDates.and.callThrough();
      spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.resolveTo([{ sk: date, ...productDate() }]);
      await component.retryAvailability();
      expect(component.passStatus).toBe('available');
      expect(component.passesAvailable).toBeTrue();
    });

    it('retries failed product dates through the visible error action', async () => {
      (component as any).loadProductDates.and.callThrough();
      const dates = spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.resolveTo(null);
      await (component as any).loadProductDates(product);
      fixture.detectChanges();
      expect(component.datesLoadFailed).toBeTrue();
      expect(board().querySelector('[role="alert"]')?.textContent).toContain('Availability unavailable');
      dates.and.resolveTo([{ sk: date, ...productDate() }]);
      Array.from(board().querySelectorAll('button')).find(b => b.textContent?.trim() === 'Try again').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.datesLoadFailed).toBeFalse();
      expect(component.passStatus).toBe('idle');
      expect(Object.keys(component.availableDates)).toEqual([date]);
    });

    it('does not submit a quantity outside the current state options', async () => {
      await load({ isOpen: true, available: 2 });
      const create = spyOn(TestBed.inject(BookingService), 'createBooking');
      component.form.get('selectedVisitors').setValue('4', { emitEvent: false });
      await component.submit();
      expect(create).not.toHaveBeenCalled();
    });

    it('returns to idle when the product is cleared', async () => {
      await load({ isOpen: true, available: 3 });
      component.form.get('selectedProduct').setValue(null);
      expect(component.passStatus).toBe('idle');
      expect(component.passesAvailable).toBeFalse();
      expect(component.availableVisitorsAllowed).toEqual([]);
      expect(component.form.get('selectedDate').value).toBeNull();
    });

    it('does not restore an old date when the product changes during retry', async () => {
      await load(null);
      (component as any).loadProductDates.and.callThrough();
      const pending = deferred();
      spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.returnValues(
        pending.promise, Promise.resolve([{ sk: nextDate, ...productDate() }])
      );
      const retry = component.retryAvailability();
      const nextProduct = 'product::c1::dayuse::a1#p2';
      component.form.get('selectedProduct').setValue(nextProduct, { emitEvent: false });
      await (component as any).loadProductDates(nextProduct);
      pending.resolve([{ sk: date, ...productDate() }]);
      await retry;
      expect(component.form.get('selectedDate').value).toBeNull();
      expect(Object.keys(component.availableDates)).toEqual([nextDate]);
      expect(component.passStatus).toBe('idle');
    });

    it('does not fetch inventory for a date no longer returned on retry', async () => {
      await load(null);
      inventory.calls.reset();
      (component as any).loadProductDates.and.callThrough();
      spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.resolveTo([{ sk: nextDate, ...productDate() }]);
      await component.retryAvailability();
      expect(inventory).not.toHaveBeenCalled();
      expect(component.form.get('selectedDate').value).toBeNull();
      expect(component.passStatus).toBe('idle');
    });
  });

  describe('reservation window', () => {
    const date = '2026-09-27';

    function selectDateWithWindow(open: number, close: number) {
      component.availableDates = {
        [date]: {
          reservationContext: { minDailyInventory: 1, maxDailyInventory: 4, temporalWindows: { reservationWindow: { open, close } } },
          inventoryPool: { isOpen: true, available: 10 }
        }
      };
      component.form.get('selectedDate').setValue(date, { emitEvent: false });
      return (component as any).loadPassesAvailable(date);
    }

    afterEach(() => fixture.destroy());

    it('gates on server time when the device clock runs fast', async () => {
      const open = Date.now() - 60 * 1000;
      TestBed.inject(ServerTimeService).record({ serverTime: open - 60 * 1000 });

      await selectDateWithWindow(open, open + 86400000);

      expect(component.passesAvailable).toBeFalse();
      expect(component.passStatus).toBe('not-open-yet');
    });

    it('shows the opening time in park time', async () => {
      const open = Date.now() + 3600000;

      await selectDateWithWindow(open, open + 86400000);

      expect(component.reservationOpensAt?.zoneName).toBe('America/Vancouver');
      expect(component.reservationOpensAt?.toMillis()).toBe(open);
    });

    it('offers passes inside the window', async () => {
      await selectDateWithWindow(Date.now() - 1000, Date.now() + 86400000);

      expect(component.passesAvailable).toBeTrue();
      expect(component.passStatus).toBe('available');
      expect(component.reservationOpensAt).toBeNull();
    });

    it('opens a page left waiting when the window opens', fakeAsync(() => {
      const open = Date.now() + 5 * 60 * 1000;
      selectDateWithWindow(open, open + 86400000);
      flushMicrotasks();
      expect(component.passStatus).toBe('not-open-yet');

      tick(5 * 60 * 1000 - 1000);
      flushMicrotasks();
      expect(component.passStatus).toBe('not-open-yet');

      tick(2000);
      flushMicrotasks();
      expect(component.passStatus).toBe('available');
      expect(component.passesAvailable).toBeTrue();
    }));

    it('cancels the opening timer when the selected date is cleared', fakeAsync(() => {
      const open = Date.now() + 5 * 60 * 1000;
      selectDateWithWindow(open, open + 86400000);
      flushMicrotasks();
      expect(component.passStatus).toBe('not-open-yet');
      component.form.get('selectedDate').setValue(null);
      tick(6 * 60 * 1000);
      flushMicrotasks();
      expect(component.passStatus).toBe('idle');
      expect(component.passesAvailable).toBeFalse();
      expect(component.reservationOpensAt).toBeNull();
    }));
  });

  describe('pass validity', () => {
    const product = 'product::c1::dayuse::a1#1';
    const at = (date: string, hour: number) => DateTime.fromISO(`${date}T${String(hour).padStart(2, '0')}:00`, { zone: 'America/Vancouver' }).toMillis();
    const productDate = (date: string, checkIn?: number, checkOut?: number) => ({
      sk: date,
      reservationContext: {
        minDailyInventory: 1,
        maxDailyInventory: 4,
        temporalAnchors: { checkInTime: checkIn, checkOutTime: checkOut },
      },
      inventoryPool: { isOpen: true, available: 10 },
    });
    const hint = () => (fixture.nativeElement as HTMLElement).querySelector('#pass-validity')?.textContent?.trim() ?? null;
    let getProductDates: jasmine.Spy;

    beforeEach(async () => {
      component.isLoggedIn = true;
      component.availableProducts = [{ display: 'Trail pass', value: product }];
      getProductDates = spyOn(TestBed.inject(ProductDateService), 'getProductDates').and.resolveTo([]);
      fixture.detectChanges();
      await fixture.whenStable();
      component.form.get('selectedProduct').setValue(product, { emitEvent: false });
    });

    afterEach(() => fixture.destroy());

    it('shows the validity window once a pass type is loaded', async () => {
      getProductDates.and.resolveTo([productDate('2026-07-15', at('2026-07-15', 7), at('2026-07-15', 13))]);

      await (component as any).loadProductDates(product);
      fixture.detectChanges();

      expect(hint()).toBe('Valid 7 am – 1 pm');
    });

    it('follows the selected date', async () => {
      getProductDates.and.resolveTo([
        productDate('2026-07-15', at('2026-07-15', 7), at('2026-07-15', 13)),
        productDate('2026-07-16', at('2026-07-16', 13), at('2026-07-16', 19)),
      ]);
      await (component as any).loadProductDates(product);

      component.form.get('selectedDate').setValue('2026-07-16', { emitEvent: false });
      await (component as any).loadPassesAvailable('2026-07-16');
      fixture.detectChanges();

      expect(hint()).toBe('Valid 1 pm – 7 pm');
    });

    it('is hidden when an anchor is missing', async () => {
      getProductDates.and.resolveTo([productDate('2026-07-15', at('2026-07-15', 7))]);

      await (component as any).loadProductDates(product);
      fixture.detectChanges();

      expect(component.passValidity).toBeNull();
      expect(hint()).toBeNull();
    });

    it('clears when the pass type changes', async () => {
      getProductDates.and.resolveTo([productDate('2026-07-15', at('2026-07-15', 7), at('2026-07-15', 13))]);
      await (component as any).loadProductDates(product);

      getProductDates.and.returnValue(new Promise(() => undefined));
      (component as any).loadProductDates('product::c1::dayuse::a1#2');
      fixture.detectChanges();

      expect(component.passValidity).toBeNull();
      expect(hint()).toBeNull();
    });
  });

  describe('hold retry', () => {
    const date = '2026-10-03';
    let bookingService: BookingService;
    let cartService: CartService;
    let toastSpy: jasmine.Spy;

    const retryError = (retryAt: DateTime) => ({
      status: 429,
      error: { msg: 'Try later', code: 'HOLD_COOLDOWN', retryAt: retryAt.toUTC().toISO() },
    });
    const el = (): HTMLElement => fixture.nativeElement;
    const notice = () => el().querySelector('#hold-retry-notice')?.textContent?.trim() ?? '';
    const bookButton = () => Array.from(el().querySelectorAll('button')).find(b => b.textContent?.includes('Book day-use pass'));

    beforeEach(() => {
      localStorage.clear();
      bookingService = TestBed.inject(BookingService);
      cartService = TestBed.inject(CartService);
      toastSpy = spyOn(TestBed.inject(ToastService), 'addMessage');
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      spyOn(component as any, 'loadProductDates').and.resolveTo();
      spyOn(component as any, 'loadPassesAvailable').and.resolveTo();

      component.isLoggedIn = true;
      component.emailVerificationLoaded = true;
      component.emailVerified = true;
      component.availabilityState = {
        status: 'available',
        selection: { collectionId: 'c1', activityType: 'dayuse', activityId: 'a1', productId: 'p1', date },
        options: [{ display: '2', value: '2' }]
      };
      component.availableProducts = [{ display: 'Trail pass', value: 'product::c1::dayuse::a1#p1' }];
      component.form.get('selectedProduct').setValue('product::c1::dayuse::a1#p1', { emitEvent: false });
      component.form.get('selectedDate').setValue(date, { emitEvent: false });
      component.form.get('selectedVisitors').setValue('2', { emitEvent: false });
      (component as any).selectedDateStr = date;
      fixture.detectChanges();
    });

    afterEach(() => {
      fixture.destroy();
      localStorage.clear();
    });

    it('shows the try-again notice and holds the Book button on a 429', async () => {
      spyOn(bookingService, 'createBooking').and.rejectWith(retryError(DateTime.now().plus({ minutes: 10 })));

      await component.submit();
      fixture.detectChanges();

      expect(notice()).toContain("You've changed this booking several times. You can try again at");
      expect(bookButton()?.getAttribute('aria-disabled')).toBe('true');
      expect(bookButton()?.getAttribute('aria-describedby')).toBe('hold-retry-notice');
      expect(toastSpy).not.toHaveBeenCalled();
    });

    it('does not try another hold while waiting', async () => {
      const create = spyOn(bookingService, 'createBooking').and.rejectWith(retryError(DateTime.now().plus({ minutes: 10 })));

      await component.submit();
      await component.submit();

      expect(create).toHaveBeenCalledTimes(1);
    });

    it('applies the wait only to the date it was returned for', async () => {
      spyOn(bookingService, 'createBooking').and.rejectWith(retryError(DateTime.now().plus({ minutes: 10 })));
      await component.submit();

      (component as any).selectedDateStr = '2026-10-04';

      expect(component.holdRetryAt).toBeNull();
    });

    it('re-enables the Book button when the wait ends', async () => {
      spyOn(bookingService, 'createBooking').and.rejectWith(retryError(DateTime.now().plus({ minutes: 10 })));
      await component.submit();

      component.onHoldRetryElapsed();

      expect(component.holdRetryAt).toBeNull();
      expect(bookButton()?.hasAttribute('aria-disabled')).toBeFalse();
      expect(notice()).toBe('');
    });

    it('shows sold out instead of the notice', async () => {
      spyOn(bookingService, 'createBooking').and.rejectWith(retryError(DateTime.now().plus({ minutes: 10 })));
      await component.submit();

      component.availabilityState = { status: 'sold-out', selection: (component.availabilityState as { selection: AvailabilitySelection }).selection };
      fixture.detectChanges();

      expect(el().querySelector('#hold-retry-notice')).toBeNull();
      expect(el().textContent).toContain('have been fully reserved');
    });

    it('falls back to the error toast for a 429 without a retry time', async () => {
      spyOn(bookingService, 'createBooking').and.rejectWith({ status: 429, error: { msg: 'Too Many Requests' } });

      await component.submit();

      expect(component.holdRetryAt).toBeNull();
      expect(toastSpy).toHaveBeenCalledWith('Too Many Requests', 'Error', jasmine.anything());
    });

    it('leaves the cart empty when the replacement hold is refused', async () => {
      cartService.addToCart({ bookingId: 'old-booking', startDate: date } as CartItem);
      spyOn(TestBed.inject(BsModalService), 'show').and.returnValue({
        content: { confirmButton: of(undefined), cancelButton: of() },
        hide: () => undefined,
        onHide: of(),
      } as any);
      const release = spyOn(cartService, 'releaseCartItem').and.resolveTo();
      spyOn(bookingService, 'createBooking').and.rejectWith(retryError(DateTime.now().plus({ minutes: 10 })));

      await component.submit();

      expect(release).toHaveBeenCalledWith(jasmine.objectContaining({ bookingId: 'old-booking' }));
      expect(cartService.items()).toEqual([]);
      expect(component.holdRetryAt).not.toBeNull();
    });

    it('stores holdLimits with the new cart item', async () => {
      spyOn(bookingService, 'createBooking').and.resolveTo({
        bookingId: 'b1', sessionId: 's1', holdLimits: { freeRemovalsLeft: 1 },
      });

      await component.submit();

      expect(cartService.items()[0]?.holdLimits).toEqual({ freeRemovalsLeft: 1 });
    });
  });
});

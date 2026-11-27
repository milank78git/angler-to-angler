// Methods exposed to the packaged WebView by FishingActivity.Device.
interface JournalDevice {
  postFavourites(owner: string, keys: string): void;
  waterCatalogueVersion(): string;
  openWaterSettings(): void;
  versionLabel(): string;
  journalName(): string;
  journalCloudDefault(): boolean;
  subjectId(): string;
  profile(): void;
  releaseCameraPhoto(): void;
  cameraFix(): string;
  weeklyDestination(): string;
  closeGroupBoard(): void;
  openProfile(): boolean;
  profileSignIn(): void;
  profileRequest(id: number, operation: string, body: string): void;
  nightMode(): boolean;
  systemBars(dark: boolean, userSelected: boolean): void;
  localeTag(): string;
  systemLocaleTag(): string;
  locale(): string;
  groupSharingOnly?(): boolean;
  shareCatch(caption: string, jpeg: string): boolean;
  networkCountry(): string;
  atlasLocation(id: number): void;
  location(id: number): void;
  cancelLocation(id: number): void;
  driveToParking(lat: number, lon: number): void;
  navigate(lat: number, lon: number): void;
  findWater(name: string): void;
  reportFish(title: string, body: string): void;
  openGroups(): void;
  fieldKind(): string;
  fieldWater(): string;
  addedWaters(): string;
  checkNearby(): void;
  nearbyWater(id: string, description: string): void;
  licenseMessage(): string;
  licenseNotificationsEnabled(): boolean;
  enableLicenseNotifications(): void;
  watching(key: string): boolean;
  reminder(key: string, enabled: boolean): void;
}
interface WindowEventMap {
  'angler-position': CustomEvent<{ id: number; fix: { lat: number; lon: number } | null }>;
}
declare var Device: JournalDevice;
interface Window {
  Device: JournalDevice;
  PlayMarket?: { refresh(): void; buy(sku: string): void };
  profileReply?(id: number, status: number, result: unknown): void;
  playMarketResult?(event: string, details?: Record<string, { credits: number; price: string }>): void;
  reminderChanged?(): void;
  waterCatalogueChanged?(): void;
  refreshLicense?(): void;
  refreshFieldSettings?(): void;
  handleBack?(): boolean | void;
  positionResult?(id: number, fix: unknown): void;
  fieldNearby?(lat: number, lon: number): void;
}
declare module '*reader-config.js' {
  export const apiOrigin: string;
  export const publishableKey: string;
}

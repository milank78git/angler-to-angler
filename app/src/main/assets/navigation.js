/** Owns destination history and the lifetime of the currently displayed screen. */
export class Navigation {
  constructor(render, confirmDiscard, getScroll = () => 0) {
    this.render = render;
    this.confirmDiscard = confirmDiscard;
    this.getScroll = getScroll;
    this.area = 'waters';
    this.stacks = new Map(['waters', 'rules', 'trips'].map((page) => [page, [{ page }]]));
    this.current = null;
  }

  /** Keep the form visible until its transaction settles or the user discards edits. */
  mayLeave() {
    return !this.current?.saving && (!this.current?.dirty || this.confirmDiscard());
  }

  open(page, props = {}) {
    if (!this.mayLeave()) return;
    if (this.stacks.has(page)) {
      if (this.current?.dirty && this.area !== page) this.stacks.get(this.area).pop();
      if (this.area === page) this.stacks.set(page, [{ page }]);
      this.area = page;
    } else {
      this.stacks.get(this.area).push({ page, ...props });
    }
    this.show();
  }

  back() {
    if (!this.mayLeave()) return true;
    const stack = this.stacks.get(this.area);
    if (stack.length > 1) stack.pop();
    else if (this.area !== 'waters') this.area = 'waters';
    else return false;
    this.show();
    return true;
  }

  /** A committed operation leaves no editable or deleted entry in the history. */
  journalAfterWrite(tripId) {
    if (this.area !== 'trips' && this.current?.route.page === 'newTrip') this.stacks.get(this.area).pop();
    this.area = 'trips';
    const stack = [{ page: 'trips' }];
    if (tripId) stack.push({ page: 'trip', id: tripId });
    this.stacks.set('trips', stack);
    this.show();
  }

  show() {
    if (this.current) {
      this.current.route.scroll = this.getScroll();
      this.current.dispose();
    }
    const stack = this.stacks.get(this.area);
    const view = {
      route: stack[stack.length - 1],
      dirty: false,
      saving: false,
      dispose: () => {},
      active: () => this.current === view,
    };
    this.current = view;
    this.render(view, this.area);
  }
}

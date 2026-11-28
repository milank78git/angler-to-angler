/** Owns destination history and the lifetime of the currently displayed screen. */
export class Navigation {
  /** Initialize independent histories for waters, rules and the private journal. */
  constructor(render, confirmDiscard, getScroll = () => 0) {
    this.render = render;
    this.confirmDiscard = confirmDiscard;
    this.getScroll = getScroll;
    this.area = 'waters';
    /** @type {Map<string, Array<{page: string, id?: string, threadId?: string, scroll?: number, additions?: Set<string>, onExit?: () => void}>>} */
    this.stacks = new Map(['waters', 'rules', 'trips'].map((page) => [page, [{ page }]]));
    this.current = null;
  }

  /** Android needs an immediate Back result while the form waits for a decision. */
  leave(transition) {
    const view = this.current;
    if (view?.saving) return true;
    if (!view?.dirty) return transition();
    this.confirmDiscard().then((discard) => {
      if (discard && view.active() && !view.saving) transition();
    });
    return true;
  }

  /** Switch tabs or push an in-tab destination after checking pending writes and edits. */
  open(page, props = {}) {
    this.leave(() => {
      if (this.stacks.has(page)) {
        if (this.current?.dirty && this.area !== page) this.stacks.get(this.area).pop();
        if (this.area === page) this.stacks.set(page, [{ page }]);
        this.area = page;
      } else {
        this.stacks.get(this.area).push({ page, ...props });
      }
      this.show();
    });
  }

  /** Let the current route handle Back before returning through its tab history. */
  back() {
    return this.leave(() => {
      const stack = this.stacks.get(this.area);
      if (this.current?.route.onExit) {
        this.current.route.onExit();
        return true;
      }
      if (stack.length > 1) stack.pop();
      else if (this.area !== 'waters') this.area = 'waters';
      else return false;
      this.show();
      return true;
    });
  }

  /** A committed operation leaves no editable or deleted entry in the history. */
  journalAfterWrite(tripId) {
    if (this.area !== 'trips' && this.current?.route.page === 'newTrip') this.stacks.get(this.area).pop();
    this.area = 'trips';
    /** @type {Array<{page: string, id?: string}>} */
    const stack = [{ page: 'trips' }];
    if (tripId) stack.push({ page: 'trip', id: tripId });
    this.stacks.set('trips', stack);
    this.show();
  }

  /** Replace the question-based destination with the conversation returned by the server. */
  backToMessage(threadId) {
    const stack = this.stacks.get(this.area);
    stack.splice(-2, 2, { page: 'messageThread', threadId });
    this.show();
  }

  /** Dispose the outgoing view and give the renderer a fresh lifetime for the new route. */
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
    return this.render(view, this.area);
  }
}

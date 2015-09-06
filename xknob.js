'use strict';

if (!window.XKnob) {
	(function() {

		// Convenience functions to sanitize numbers.
		var float_or_default = function(x, def) {
			x = parseFloat(x);
			return isNaN(x) ? def : x;
		};
		var int_or_default = function(x, def) {
			x = parseInt(x, 10);
			return isNaN(x) ? def : x;
		};

		////////////////////
		// Global internal variables for UI handling.

		// A XKnob element if one is being dragged right now.
		//
		// Limitation: only one can be changed at the same time.
		//
		// This limitation is not a problem on mouse-driven interfaces, as
		// there is only a single mouse (well, on most systems anyway).
		//
		// For multi-touch interfaces, this code should be rewritten to support
		// multiple knobs being changed at the same time.
		var xknob_being_dragged = null;

		// The mouse (or touch) angle from the last event. Used to calculate
		// the direction (CW or CCW).
		var xknob_drag_previous_angle = null;

		// The (proposed, before applying min/max/divisions) value from the
		// last event.
		var xknob_drag_previous_value = null;

		// The initial value upon starting to drag the knob. Used to decide if
		// 'change' event should be fired.
		var xknob_drag_initial_value = null;

		////////////////////
		// Event handling functions.

		var add_listeners_to_document = function(elem) {
			if (elem instanceof HTMLElement) {
				elem = elem.ownerDocument;
			}
			// Duplicate event listeners are discarded.
			elem.addEventListener('mouseup', stop_dragging);
			elem.addEventListener('mousemove', drag_rotate);
			elem.addEventListener('touchend', stop_dragging);
			elem.addEventListener('touchmove', drag_rotate);
		}
		var remove_listeners_from_document = function(elem) {
			if (elem instanceof HTMLElement) {
				elem = elem.ownerDocument;
			}
			elem.removeEventListener('mouseup', stop_dragging);
			elem.removeEventListener('mousemove', drag_rotate);
			elem.removeEventListener('touchend', stop_dragging);
			elem.removeEventListener('touchmove', drag_rotate);
		}

		// Should be attached to '.knob_gfx'.
		var start_dragging = function(ev) {
			remove_listeners_from_document(ev.target);
			xknob_being_dragged = null;

			// Only handling clicks with the left mouse button.
			if (ev.type === 'mousedown' && ev.button !== 0) {
				return;
			}

			// Finding the XKnob element.
			// ev.target is where the event was originated.
			// ev.currentTarget is where the event listener was attached.
			var shadow_root = ev.currentTarget;
			while (shadow_root && !(shadow_root instanceof ShadowRoot)) {
				shadow_root = shadow_root.parentNode;
			}
			if (!shadow_root) return;
			var xknob = shadow_root.host;
			if (!xknob) return;

			// No reaction if the element is disabled or readonly.
			if (xknob.disabled || xknob.readonly) {
				// Should we call preventDefault/stopPropagation here?
				return;
			}

			// Actual event handling.
			ev.preventDefault();
			ev.stopPropagation();
			xknob_being_dragged = xknob;
			xknob_drag_previous_angle = xknob._get_mouse_angle(ev);
			xknob_drag_previous_value = xknob.value;
			xknob_drag_initial_value = xknob.value;

			add_listeners_to_document(xknob);

			// Giving the element focus to enable keyboard events.
			// We need to do this here because we called preventDefault() and
			// stopPropagation().
			xknob.focus();
		}

		// Should be attached to the document, because this event may happen
		// outside of XKnob.
		var stop_dragging = function(ev) {
			if (!xknob_being_dragged) {
				remove_listeners_from_document(ev.target);
				return;
			}

			if (xknob_being_dragged.disabled || xknob_being_dragged.readonly) {
				remove_listeners_from_document(ev.target);
				return;
			}

			if (xknob_drag_initial_value !== xknob_being_dragged.value) {
				xknob_being_dragged.dispatchEvent(new Event('change', {
					'bubbles': true,
					'cancelable': false
				}));
			}

			remove_listeners_from_document(ev.target);
			xknob_being_dragged = null;
		}

		// Should be attached to the document, because this event may happen
		// outside of XKnob.
		var drag_rotate = function(ev) {
			if (!xknob_being_dragged) {
				remove_listeners_from_document(ev.target);
				return;
			}

			if (xknob_being_dragged.disabled || xknob_being_dragged.readonly) {
				remove_listeners_from_document(ev.target);
				return;
			}

			var new_angle = xknob_being_dragged._get_mouse_angle(ev);
			var old_angle = xknob_drag_previous_angle;
			xknob_drag_previous_angle = new_angle;

			var delta_angle = new_angle - old_angle;
			if (delta_angle < 0) {
				// Because this is a circle
				delta_angle += Math.PI * 2;
			}
			if (delta_angle > Math.PI) {
				// Converting from 0..360 to -180..180.
				delta_angle -= Math.PI * 2;
			}
			console.assert(delta_angle >= -Math.PI && delta_angle <= Math.PI, {'delta_angle': delta_angle, 'old_angle': old_angle, 'new_angle': new_angle});

			var delta_value = delta_angle / Math.PI / 2;
			var new_proposed_value = xknob_drag_previous_value + delta_value;
			var old_actual_value = xknob_being_dragged.value;

			xknob_being_dragged.value = new_proposed_value;

			// The .value setter changes the xknob_drag_previous_value variable
			// (in case the setter was implicitly called by the user).
			// Here, however, we need xknob_drag_previous_value set to this
			// specific value, so we overwrite it.
			xknob_drag_previous_value = new_proposed_value;

			var new_actual_value = xknob_being_dragged.value;
			if (old_actual_value !== new_actual_value) {
				xknob_being_dragged.dispatchEvent(new Event('input', {
					'bubbles': true,
					'cancelable': false
				}));
			}
		}

		// Keyboard support when receiving focus.
		var keypress_handler = function(ev) {
			if (ev.target.disabled) {
				return;
			}

			// Some constants.
			var STEP_SIZE_SMALL = 1;  // For Arrows.
			var STEP_SIZE_MEDIUM = 2;  // For PageUp/PageDown.
			var STEP_SIZE_EXTREME = 3;  // For Home/End.

			var step_size = null;
			var step_direction = null;

			// ev.code and ev.key are new to DOM 3 Events:
			// https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
			// https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key

			// If I remap my keyboard (e.g. I've remapped Caps Lock to be
			// Escape), then ev.key shows the remapped value (e.g. Escape),
			// while ev.code shows the actual physical key (e.g. Caps Lock).
			//
			// Also, if NumLock is off, numpad keys return their alternate
			// value in ev.key (e.g. ArrowUp), and the actual physical key in
			// ev.code (e.g. Numpad8).
			//
			// For this component, ev.key makes more sense than ev.code, as we
			// are interested in the logical value/action, and not the physical
			// key location.

			switch (ev.key) {
				// The same direction/orientation as <input type="range">.
				case 'Home':
				case 'PageDown':
				case 'ArrowLeft':
				case 'ArrowDown':
					step_direction = -1;
					break;
				case 'End':
				case 'PageUp':
				case 'ArrowRight':
				case 'ArrowUp':
					step_direction = +1;
					break;
				default:
					return;
			}
			switch (ev.key) {
				case 'Home':
				case 'End':
					step_size = STEP_SIZE_EXTREME;
					break;
				case 'PageUp':
				case 'PageDown':
					step_size = STEP_SIZE_MEDIUM;
					break;
				case 'ArrowRight':
				case 'ArrowLeft':
				case 'ArrowDown':
				case 'ArrowUp':
					step_size = STEP_SIZE_SMALL;
					break;
				default:
					return;
			}

			// Sanity check.
			if (step_size === null || step_direction === null) {
				console.error('This should not happen! step_size=' + step_size + ', step_direction=' + step_direction);
				return;
			}

			ev.preventDefault();
			//ev.stopPropagation();

			// Read-only will receive and process the events, but won't change
			// the value.
			if (ev.target.readonly) {
				return;
			}

			var initial_value = ev.target.value;

			if (step_size === STEP_SIZE_EXTREME) {
				if (step_direction < 0) {
					if (ev.target.min !== null) {
						ev.target.value = ev.target.min;
					}
				} else if (step_direction > 0) {
					if (ev.target.max !== null) {
						ev.target.value = ev.target.max;
					}
				}
			} else if (step_size === STEP_SIZE_MEDIUM) {
				var divisions = ev.target.divisions;
				var step = 1.0 / 8;
				// Finding a step amount near 45deg:
				if (divisions >= 2) {
					step = Math.round(step * divisions) / divisions;
					// In case the previous expression evaluated to zero.
					step = Math.max(step, 1.0 / divisions);
				}
				ev.target.value += step * step_direction;
			} else if (step_size === STEP_SIZE_SMALL) {
				var divisions = ev.target.divisions;
				var step = 1.0 / 64;
				if (divisions >= 2) {
					step = 1.0 / divisions;
				}
				ev.target.value += step * step_direction;
			} else {
				console.error('This should not happen! Unknown step_size: ' + step_size);
			}

			if (initial_value !== ev.target.value) {
				ev.target.dispatchEvent(new Event('input', {
					'bubbles': true,
					'cancelable': false
				}));
				ev.target.dispatchEvent(new Event('change', {
					'bubbles': true,
					'cancelable': false
				}));

				// Trying to improve the corner-case of someone dragging the
				// control at same time as using keyboard.
				if (xknob_being_dragged) {
					xknob_drag_initial_value = ev.target.value;
				}
			}
		}

		////////////////////
		// The actual XKnob object.
		var XKnob = document.registerElement('x-knob', {
			'prototype': Object.create(HTMLElement.prototype, {
				'createdCallback': {
					'value': function() {
						// Making this element focusable.
						if (!this.hasAttribute('tabindex')) {
							this.tabIndex = 0;
						} else {
							// No action needed, the browser already sets
							// .tabIndex value to the tabindex attribute.
						}
						// Please also check this issue:
						// https://github.com/whatwg/html/issues/113

						// Specs also mention 'beforeinput' event, but it is
						// not implemented in browsers, and I don't see why it
						// would be better than 'keydown'.
						this.addEventListener('keydown', keypress_handler);
						// Note: 'keypress' event does not work.

						// Default values for private vars.
						this._disabled = false;
						this._readonly = false;
						this._divisions = 0;
						this._min = null;
						this._max = null;
						this._svgsymbolid = null;
						this._value = 0;

						// Setting values from attributes.
						for (var attr of ['divisions', 'min', 'max', 'svgsymbolid', 'value']) {
							if (this.hasAttribute(attr)) {
								this[attr] = this.getAttribute(attr);
							}
						}
						for (var attr of ['disabled', 'readonly']) {
							if (this.hasAttribute(attr)) {
								this[attr] = true;
							}
						}

						if (this._svgsymbolid === null) {
							this._update_innerHTML();
						}
					}
				},
				'attributeChangedCallback' : {
					'value': function(attrName, oldVal, newVal) {
						attrName = attrName.toLowerCase();
						if (['divisions', 'min', 'max', 'svgsymbolid', 'value'].indexOf(attrName) > -1) {
							this[attrName] = newVal;
						} else if (['disabled', 'readonly'].indexOf(attrName) > -1) {
							if (newVal === null) {
								// Attribute has been removed.
								this[attrName] = false;
							} else {
								this[attrName] = true;
							}
						}
					}
				},

				// HTMLInputElement-inspired properties.
				// Upon getting, returns a number (or null) instead of a string.
				'disabled': {
					'get': function() {
						return this._disabled;
					},
					'set': function(x) {
						this._disabled = !!x;
					}
				},
				'readonly': {
					'get': function() {
						return this._readonly;
					},
					'set': function(x) {
						this._readonly = !!x;
					}
				},
				'divisions': {
					'get': function() {
						return this._divisions;
					},
					'set': function(x) {
						this._divisions = int_or_default(x, 0);
						this._update_value();
					}
				},
				'min': {
					'get': function() {
						return this._min;
					},
					'set': function(x) {
						this._min = float_or_default(x, null);
						this._update_value();
					}
				},
				'max': {
					'get': function() {
						return this._max;
					},
					'set': function(x) {
						this._max = float_or_default(x, null);
						this._update_value();
					}
				},
				'svgsymbolid': {
					'get': function() {
						return this._svgsymbolid;
					},
					'set': function(x) {
						x = '' + x;  // Forcing conversion to string.
						// https://stackoverflow.com/questions/70579/what-are-valid-values-for-the-id-attribute-in-html
						// http://www.w3.org/TR/html4/types.html#type-id
						if (/^[A-Za-z][-A-Za-z0-9_:.]*$/.test(x)) {
							this._svgsymbolid = x;
						} else {
							this._svgsymbolid = null;
						}
						this._update_innerHTML();
					}
				},
				'value': {
					'get': function() {
						return this._value;
					},
					'set': function(x) {
						this._value = float_or_default(x, 0);
						this._update_value();
					}
				},

				'_update_innerHTML': {
					'value': function() {
						if (!this.shadowRoot) {
							this.createShadowRoot();
						}

						var symbol = null;
						if (this._svgsymbolid) {
							symbol = this.ownerDocument.getElementById(this._svgsymbolid);
							if (symbol && symbol.tagName.toLowerCase() === 'symbol') {
								symbol = symbol.cloneNode(true);
							} else {
								symbol = null;
							}
						}
						var id = 'default_x-knob_gfx'
						if (symbol) {
							id = symbol.getAttribute('id');
						}

						this.shadowRoot.innerHTML = '' +
							'<svg viewBox="-1 -1 2 2" style="display: block; width: 100%; height: 100%; pointer-events: none;">' +
							'  <defs></defs>' +
							'  <circle class="knob_center" cx="0" cy="0" r="0.0078125" fill="none" opacity="0" pointer-events="none"/>' +
							// https://stackoverflow.com/questions/826782/css-rule-to-disable-text-selection-highlighting
							'  <use class="knob_gfx" xlink:href="#' + id + '" x="-1" y="-1" width="2" height="2" style="cursor: default; pointer-events: auto; -webkit-touch-callout: none; -ms-user-select: none; -moz-user-select: none; -webkit-user-select: none; user-select: none;"/>' +
							'  </g>' +
							'</svg>';

						if (symbol) {
							this.shadowRoot.querySelector('defs').appendChild(symbol);
						} else {
							this.shadowRoot.querySelector('defs').innerHTML = '' +
								'<symbol id="default_x-knob_gfx" viewBox="-6 -6 12 12">' +
								'  <circle cx="0" cy="0" r="5.875" stroke="#2e3436" fill="#babdb6" stroke-width="0.25"/>' +
								'  <line x1="0" y1="-1.5" x2="0" y2="-4.75" stroke="#2e3436" stroke-width="0.5px" stroke-linecap="round"/>' +
								'</symbol>';
						}

						this.shadowRoot.querySelector('.knob_gfx').addEventListener('mousedown', start_dragging);
						this.shadowRoot.querySelector('.knob_gfx').addEventListener('touchstart', start_dragging);
						this._update_gfx_rotation();
					}
				},
				'_update_value': {
					'value': function() {
						// Sanity check.
						if (!Number.isFinite(this._value)) {
							this._value = 0;
						}

						// Snapping to one of the circle divisions.
						if (Number.isFinite(this._divisions) && this._divisions >= 2) {
							this._value = Math.round(this._value * this._divisions) / this._divisions;
						}

						// Clamping to the defined min..max range.
						if (Number.isFinite(this._max) && this._value > this._max) {
							this._value = this._max;
						}
						if (Number.isFinite(this._min) && this._value < this._min) {
							this._value = this._min;
						}

						// If the element being dragged had .value updated by the user.
						//
						// Note: This may cause drifting, may cause the knob
						// moving a further away or behind the cursor. The only
						// way to avoid drifting is by NOT updating .value
						// while the control is being dragged.
						if (this === xknob_being_dragged) {
							// Please also read the comment inside drag_rotate() function.
							xknob_drag_previous_value = this._value;
						}

						this._update_gfx_rotation();
					}
				},
				'_update_gfx_rotation': {
					'value': function() {
						if (this.shadowRoot) {
							var elem = this.shadowRoot.querySelector('.knob_gfx');
							if (elem) {
								elem.style.transform = 'rotate(' + (this._value * 360) + 'deg)';
							}
						}
					}
				},

				'_get_center_position': {
					'value': function() {
						// Invisible element used to get the X,Y coordinates.
						var rect = this.shadowRoot.querySelector('.knob_center').getBoundingClientRect();
						return [
							rect.left + (rect.right - rect.left) / 2,
							rect.top + (rect.bottom - rect.top) / 2
						];
					}
				},

				'_get_mouse_angle': {
					'value': function(ev) {
						var center = this._get_center_position();

						// Mouse position.
						var cursor = [ev.clientX, ev.clientY];

						// Or finger touch position.
						if (ev.targetTouches && ev.targetTouches[0]) {
							cursor = [ev.targetTouches[0].clientX, ev.targetTouches[0].clientY];
						}

						var rad = Math.atan2(cursor[1] - center[1], cursor[0] - center[0]);
						rad += Math.PI / 2;

						return rad;
					}
				},
			})
		});

		window.XKnob = XKnob;
	})();
}

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

		// Should be attached to '.knob_gfx'.
		var start_dragging = function(ev) {
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

			// Actual event handling.
			ev.preventDefault();
			ev.stopPropagation();
			xknob_being_dragged = xknob;
			xknob_drag_previous_angle = xknob._get_mouse_angle(ev);
			xknob_drag_previous_value = xknob.value;
			xknob_drag_initial_value = xknob.value;
		}

		// Should be attached to the document, because this event may happen
		// outside of XKnob.
		var stop_dragging = function(ev) {
			if (!xknob_being_dragged) return;

			if (xknob_drag_initial_value !== xknob_being_dragged.value) {
				xknob_being_dragged.dispatchEvent(new Event('change', {
					'bubbles': true,
					'cancelable': false
				}));
			}

			xknob_being_dragged = null;
		}

		// Should be attached to the document, because this event may happen
		// outside of XKnob.
		var drag_rotate = function(ev) {
			if (!xknob_being_dragged) return;

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
			xknob_drag_previous_value = new_proposed_value;

			var old_actual_value = xknob_being_dragged.value;
			xknob_being_dragged.value = new_proposed_value;
			var new_actual_value = xknob_being_dragged.value;
			if (old_actual_value !== new_actual_value) {
				xknob_being_dragged.dispatchEvent(new Event('input', {
					'bubbles': true,
					'cancelable': false
				}));
			}
		}

		////////////////////
		// The actual XKnob object.
		var XKnob = document.registerElement('x-knob', {
			'prototype': Object.create(HTMLElement.prototype, {
				'createdCallback': {
					'value': function() {
						this.createShadowRoot().innerHTML = '' +
							'<svg viewBox="-6 -6 12 12">' +
							'  <circle class="knob_center" cx="0" cy="0" r="0.015625"/>' +
							'  <g class="knob_gfx">' +
							'    <circle cx="0" cy="0" r="5"/>' +
							'    <line x1="0" y1="-1.25" x2="0" y2="-4.5"/>' +
							'  </g>' +
							'</svg>';

						this.shadowRoot.querySelector('.knob_gfx').addEventListener('mousedown', start_dragging);
						this.shadowRoot.querySelector('.knob_gfx').addEventListener('touchstart', start_dragging);

						// Duplicate event listeners are discarded.
						this.ownerDocument.addEventListener('mouseup', stop_dragging);
						this.ownerDocument.addEventListener('mousemove', drag_rotate);
						this.ownerDocument.addEventListener('touchend', stop_dragging);
						this.ownerDocument.addEventListener('touchmove', drag_rotate);

						// Default values for private vars.
						this._divisions = 0;
						this._min = null;
						this._max = null;
						this._value = 0;

						// Setting values from attributes.
						for (var attr of ['divisions', 'min', 'max', 'value']) {
							if (this.hasAttribute(attr)) {
								this[attr] = this.getAttribute(attr);
							}
						}
					}
				},
				'attributeChangedCallback' : {
					'value': function(attrName, oldVal, newVal) {
						attrName = attrName.toLowerCase();
						if (['divisions', 'min', 'max', 'value'].indexOf(attrName) > -1) {
							this[attrName] = newVal;
						}
					}
				},

				// HTMLInputElement-inspired properties.
				// Upon getting, returns a number (or null) instead of a string.
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
				'value': {
					'get': function() {
						return this._value;
					},
					'set': function(x) {
						this._value = float_or_default(x, 0);
						this._update_value();
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

						// Updating the graphic.
						this.shadowRoot.querySelector('.knob_gfx').style.transform = 'rotate(' + (this._value * 360) + 'deg)';
					}
				},

				'_get_center_position': {
					'value': function() {
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

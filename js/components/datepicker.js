import flatpickr from "flatpickr";
import { el, icon } from "../utils.js";

/**
 * Attaches a modern, styled Flatpickr datepicker to an input element.
 *
 * @param {HTMLInputElement} inputEl - The target input
 * @param {Object} options - Custom flatpickr options (e.g. maxDate, minDate, defaultDate)
 * @returns {Object} flatpickr instance
 */
export function attachDatePicker(inputEl, options = {}) {
  if (!inputEl) return null;

  // Destroy previous instance if any
  if (inputEl._flatpickr) {
    inputEl._flatpickr.destroy();
  }

  // Change input type to text so the browser doesn't pop up its legacy calendar
  inputEl.type = "text";

  const defaultDate = options.defaultDate || inputEl.value || null;

  const fp = flatpickr(inputEl, {
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d M Y",
    altInputClass: inputEl.className || "flatpickr-custom-input",
    allowInput: true,
    disableMobile: true, // Guarantees the modern theme on all screen sizes
    defaultDate: defaultDate || undefined,
    ...options,
    onChange: (selectedDates, dateStr, instance) => {
      // Trigger native change event so any existing listeners fire automatically
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      if (options.onChange) {
        options.onChange(selectedDates, dateStr, instance);
      }
    },
  });

  return fp;
}

/**
 * Creates an input element wrapped in a container with a calendar icon and attached flatpickr.
 *
 * @param {Object} attrs - Attributes for the input (id, name, value, placeholder, etc.)
 * @param {Object} options - Flatpickr options
 * @returns {HTMLElement} The wrapper element
 */
export function datePickerInput(attrs = {}, options = {}) {
  const input = el("input", {
    type: "text",
    placeholder: attrs.placeholder || "Select date...",
    ...attrs,
  });

  const calIcon = el("span", { class: "material-symbols-rounded datepicker-icon" }, "calendar_today");
  const wrap = el("div", { class: "datepicker-input-wrap" }, [input, calIcon]);

  // Attach flatpickr after element is created
  setTimeout(() => {
    attachDatePicker(input, options);
  }, 0);

  return wrap;
}

/**
 * Creates a standard form field (.field) containing a label and a modern datepicker.
 *
 * @param {string} id - The input ID
 * @param {string} label - The label text
 * @param {string} value - Default date value (YYYY-MM-DD)
 * @param {Object} options - Flatpickr options
 * @param {boolean} full - Whether the field spans full width in grid
 * @returns {HTMLElement} The .field element
 */
export function datePickerField(id, label, value = "", options = {}, full = false) {
  const inputWrap = datePickerInput({ id, value }, options);
  return el("div", { class: `field${full ? " field--full" : ""}` }, [
    el("label", { for: id }, label),
    inputWrap,
  ]);
}

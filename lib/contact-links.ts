// Links of the technician views (task-11-3): call the contact and navigate to the site.

// Google Maps universal link with directions from the current location; no API key. Opens the Maps app on
// iOS/Android when installed, otherwise Google Maps in the browser.
export function routeHref(address: string) {
  const params = new URLSearchParams({ api: "1", destination: address.trim(), travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${params.toString().replace(/\+/g, "%20")}`;
}

// tel: link with digits and a leading + only
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

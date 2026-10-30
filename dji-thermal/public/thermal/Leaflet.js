// WebODM's own Leaflet (1.3.1) with its stylesheet, for the mosaic viewer (viewer.js loads this module through
// WebODM's PluginsAPI.SystemJS). WebODM's plugin build treats "leaflet" as a global that only its own map pages have,
// so it is imported by its file, which bundles it into the plugin's build.
import L from 'leaflet/dist/leaflet-src.js';
import 'leaflet/dist/leaflet.css';

export default L;

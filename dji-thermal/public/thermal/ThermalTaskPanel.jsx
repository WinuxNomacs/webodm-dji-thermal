import React from 'React';
import PropTypes from 'prop-types';
import NewTaskPanel from 'webodm/components/NewTaskPanel';
import exifr from 'webodm/vendor/exifr';
import { unitSystem } from 'webodm/classes/Units';
import { _, interpolate } from 'webodm/classes/gettext';
import MeasurementSettings from './MeasurementSettings';
import { combineCameras, defaultUnit, requestData, startPalette, validate } from './measurement';
import ThermalUpload from './upload';
import serverApi from './serverApi';
import { MAX_PITCH, PANEL_OPTIONS, byPitch, gimbalPitch, sameOptions } from './plan';

// The camera model, date and position, and DJI's XMP (the gimbal pitch)
const EXIF_OPTIONS = {ifd0: [0x0110], exif: [0x9003], gps: [0x0001, 0x0002, 0x0003, 0x0004], xmp: true, interop: false, ifd1: false};
const PRESET_TRIES = 150;   // WebODM's panel loading its presets: 30 s at PRESET_MS
const PRESET_MS = 200;

function readExif(file){
    return exifr.parse(file, EXIF_OPTIONS).then(exif => exif || {}, () => ({}));
}

// The panel of a new thermal task, for the files picked with the DJI Thermal Task button: the pitch limit, Normalize and
// Harmonize, the Measurement section, whether to keep the photos in a DJI Thermal Analyzer dataset too, then WebODM's
// own task panel (name, processing node, options starting from the plan's, the photos on the map; no resizing).
export default class ThermalTaskPanel extends React.Component {
    static propTypes = {
        projectId: PropTypes.number.isRequired,
        files: PropTypes.object.isRequired, // rjpeg.sortFiles()
        onTaskAdded: PropTypes.func.isRequired, // (result)
        onCancel: PropTypes.func.isRequired,
        api: PropTypes.object
    };

    static defaultProps = {
        api: serverApi
    };

    constructor(props){
        super(props);
        this.state = {
            phase: "describing", // then "editing", "uploading"
            photos: [],
            unsupported: [], // [{name, reason}]
            combined: null,
            values: {distanceMode: "lrf"},
            unit: defaultUnit(unitSystem()),
            errors: {},
            keepPhotos: false,
            frames: {normalize: false, harmonize: false, mosaics: false},
            pitchLimit: true,
            maxPitch: String(MAX_PITCH),
            palette: "",
            error: "",
            progress: null
        };
    }

    componentDidMount(){
        this.describeCameras();
    }

    componentWillUnmount(){
        this.unmounted = true;
        clearTimeout(this.presetTimer);
        if (this.upload) this.upload.cancel();
    }

    update(state){
        if (!this.unmounted) this.setState(state);
    }

    // One photo of each camera model is described by the server: its recorded values and ranges
    describeCameras(){
        const photos = this.props.files.photos;
        if (!photos.length){
            this.update({phase: "editing", error: _("None of the files picked is a DJI thermal photo.")});
            return;
        }
        Promise.all(photos.map(readExif)).then(exifs => {
            const byModel = {};
            this.pitches = new Map(photos.map((p, i) => [p, gimbalPitch(exifs[i])]));
            photos.forEach((p, i) => {
                const model = exifs[i].Model || "";
                (byModel[model] = byModel[model] || []).push(p);
            });
            const models = Object.keys(byModel);
            return Promise.all(models.map(m => this.props.api.describe(byModel[m][0]).catch(e => ({thermal: false, reason: e.message}))))
                .then(descriptions => {
                    let kept = [], unsupported = [];
                    const described = [];
                    descriptions.forEach((d, i) => {
                        const group = byModel[models[i]];
                        if (d.thermal){
                            kept = kept.concat(group);
                            described.push(d);
                        }else{
                            unsupported = unsupported.concat(group.map(p => ({name: p.name, reason: d.reason})));
                        }
                    });
                    const keptSet = new Set(kept);
                    const combined = described.length ? combineCameras(described) : null;
                    this.update({
                        phase: "editing",
                        photos: photos.filter(p => keptSet.has(p)),
                        unsupported,
                        combined,
                        palette: combined ? startPalette(combined) : "",
                        error: described.length ? "" : _("None of the files picked is a DJI thermal photo this plugin can convert.")
                    });
                });
        }).catch(e => this.update({phase: "editing", error: e.message}));
    }

    getFiles = () => this.state.photos.concat(this.props.files.textFiles);

    // As WebODM's own panel: a name from the first photo's date, and the map preview if it has a position. The
    // place name WebODM looks up online is left out: the plugin calls no outside service.
    suggestedTaskName = (hasGPSCallback) => {
        const first = this.state.photos[0];
        if (!first) return Promise.reject();
        return readExif(first).then(exif => {
            if (exif.latitude && exif.longitude && hasGPSCallback) hasGPSCallback();
            let date = exif.DateTimeOriginal;
            date = date && date.toLocaleDateString ? date.toLocaleDateString() : new Date(first.lastModified).toLocaleDateString();
            return interpolate(_("Thermal - %(date)s"), {date});
        });
    };

    handleValuesChange = values => {
        this.setState({values, errors: validate(values, this.state.combined, this.state.unit)});
    };

    handleUnitChange = unit => {
        this.setState({unit, errors: validate(this.state.values, this.state.combined, unit)});
    };

    // The pitch limit in degrees, null for none, or NaN when it isn't one
    maxPitch(){
        if (!this.state.pitchLimit) return null;
        const pitch = parseFloat(this.state.maxPitch);
        return pitch >= -90 && pitch <= 90 ? pitch : NaN;
    }

    keptPhotos(){
        const pitch = this.maxPitch();
        return byPitch(this.state.photos, this.pitches || new Map(), isNaN(pitch) ? null : pitch).kept;
    }

    handleSave = taskInfo => {
        const errors = validate(this.state.values, this.state.combined, this.state.unit);
        if (Object.keys(errors).length){
            this.setState({errors});
            this.resetNewTaskPanel();
            return;
        }
        const pitch = this.maxPitch();
        const pitchError = isNaN(pitch) ? _("The pitch limit is a number of degrees from -90 to 90.") :
            !this.keptPhotos().length ? interpolate(_("No photo has a gimbal pitch at or below %(pitch)s°."), {pitch}) : "";
        if (pitchError){
            this.setState({error: pitchError});
            this.resetNewTaskPanel();
            return;
        }

        this.upload = new ThermalUpload({
            projectId: this.props.projectId,
            taskInfo,
            photos: this.state.photos,
            textFiles: this.props.files.textFiles,
            measurement: Object.assign(requestData(this.state.values, this.state.unit), {palette: this.state.palette}),
            api: this.props.api,
            onProgress: progress => this.update({progress}),
            keepPhotos: this.keepsPhotos(),
            otherPhotos: this.otherPhotos(),
            frames: this.state.frames,
            maxPitch: pitch,
            pitches: this.pitches,
            planOptions: sameOptions(taskInfo.options, PANEL_OPTIONS)
        });
        this.setState({phase: "uploading", error: "", progress: this.upload.initialProgress()});
        this.upload.start().then(result => {
            this.upload = null;
            result.ignored = result.ignored.concat(this.state.unsupported);
            result.otherFiles = this.props.files.ignored.length;
            this.props.onTaskAdded(result);
        }, e => {
            const canceled = this.upload && this.upload.canceled;
            this.upload = null;
            if (canceled) this.props.onCancel();
            else{
                this.update({phase: "editing", error: e.message, progress: null});
                this.resetNewTaskPanel();
            }
        });
    };

    // Normalizing or harmonizing goes through a workset of the task's dataset, which keeps the photos
    keepsPhotos(){
        return this.state.keepPhotos || this.state.frames.normalize;
    }

    handleFramesChange = e => {
        const frames = Object.assign({}, this.state.frames, {[e.target.name]: e.target.checked});
        if (e.target.name === "harmonize" && e.target.checked) frames.normalize = true;
        if (e.target.name === "normalize" && !e.target.checked) frames.harmonize = frames.mosaics = false;
        this.setState({frames});
    };

    // The palette the task's thermal map opens in (conversion_tasks.task_palette), the photos' to start with
    renderPalette(){
        const { combined, palette } = this.state;
        if (!combined.palettes.length) return "";
        return (
            <div className="form-group dji-thermal-palette">
                <label className="col-sm-2 control-label" htmlFor="dji-thermal-palette">{_("Palette")}</label>
                <div className="col-sm-10">
                    <select id="dji-thermal-palette" className="form-control dji-thermal-input" value={palette}
                            onChange={e => this.setState({palette: e.target.value})}>
                        {combined.palettes.map(p =>
                            <option key={p} value={p}>{p === combined.palette ? interpolate(_("%(palette)s (the photos')"), {palette: p}) : p}</option>
                        )}
                    </select>
                    <span className="help-block">{_("The palette the task's thermal map opens in, unless you have chosen one in the DJI Thermal Analyzer's preferences. The task's images hold temperatures: the map can show them in any palette later.")}</span>
                </div>
            </div>
        );
    }

    // WebODM's panel starts from the plan's options, as its "(Custom)" preset, once it has loaded its presets
    presetOptions = (tries = 0) => {
        const form = this.newTaskPanel && this.newTaskPanel.taskForm;
        if (this.unmounted) return;
        if (!form || !form.state.loadedPresets){
            if (tries < PRESET_TRIES) this.presetTimer = setTimeout(() => this.presetOptions(tries + 1), PRESET_MS);
            return;
        }
        const custom = (form.state.presets || []).find(p => p.id === -1);
        if (!custom) return;
        custom.options = PANEL_OPTIONS.map(o => Object.assign({}, o));
        form.setState({selectedPreset: custom});
    };

    handleNewTaskPanel = panel => {
        const first = panel && !this.newTaskPanel;
        this.newTaskPanel = panel;
        if (first) this.presetOptions();
    };

    renderPitch(){
        const { photos, pitchLimit, maxPitch } = this.state;
        const kept = this.keptPhotos().length;
        return (
            <div className="checkbox dji-thermal-pitch">
                <label>
                    <input type="checkbox" name="pitchLimit" checked={pitchLimit} onChange={e => this.setState({pitchLimit: e.target.checked})} />
                    {" "}{_("Only frames looking down: a gimbal pitch at or below")}
                </label>
                {" "}<span className="input-group dji-thermal-pitch-input">
                    <input type="number" step="1" min="-90" max="90" className="form-control input-sm" value={maxPitch}
                           disabled={!pitchLimit} aria-label={_("Pitch limit")} onChange={e => this.setState({maxPitch: e.target.value})} />
                    <span className="input-group-addon">°</span>
                </span>
                {" "}<strong>{interpolate(_("%(kept)s of %(count)s frames"), {kept, count: photos.length})}</strong>
                <span className="help-block">{_("As the WebODM plan: oblique frames mix viewing angles and sky into the map's temperatures. Unticked, every frame goes in (for a 3D model).")}</span>
            </div>
        );
    }

    renderFrames(){
        const { frames } = this.state;
        return (
            <div className="dji-thermal-frames">
                {this.renderPitch()}
                <div className="checkbox">
                    <label>
                        <input type="checkbox" name="normalize" checked={frames.normalize} onChange={this.handleFramesChange} />
                        {" "}{_("Normalize: one ambient and reflected temperature for every frame")}
                    </label>
                    <span className="help-block">{_("The flight's medians of the values the camera recorded, unless given below: no jumps between frames where the recorded values change.")}</span>
                </div>
                <div className="checkbox">
                    <label>
                        <input type="checkbox" name="harmonize" checked={frames.harmonize} onChange={this.handleFramesChange} />
                        {" "}{_("Harmonize: each frame's drift against its overlapping neighbours removed")}
                    </label>
                    <span className="help-block">{_("The camera drifts between its recalibrations: removing it leaves no seams in the map. Compares the frames' overlaps, which takes a while. Normalizes too.")}</span>
                </div>
                {frames.normalize ?
                    <div className="checkbox">
                        <label>
                            <input type="checkbox" name="mosaics" checked={frames.mosaics} onChange={this.handleFramesChange} />
                            {" "}{_("Also build the workset's mosaics")}
                        </label>
                        <span className="help-block">{_("The DJI Thermal Analyzer's mosaics of the converted photos, built after the task starts. They can be built later from the workset's menu (Build mosaics).")}</span>
                    </div>
                : ""}
                {frames.normalize ?
                    <p className="help-block">{_("All the photos are uploaded first, to the task's DJI Thermal Analyzer dataset; WebODM's worker then converts them in a workset of it, and the task starts processing once they are converted. You can close the page once the upload is done.")}</p>
                : ""}
            </div>
        );
    }

    // The photos picked that are not converted: the RGB ones, and those of a camera the plugin cannot convert
    otherPhotos(){
        const kept = new Set(this.state.photos);
        return this.props.files.photos.filter(p => !kept.has(p)).concat(this.props.files.ignored);
    }

    // NewTaskPanel shows "Loading…" once saved: back to its form, to correct the values or try again
    resetNewTaskPanel(){
        if (this.newTaskPanel && !this.unmounted) this.newTaskPanel.setState({loading: false, inReview: false});
    }

    handleCancelUpload = () => {
        if (this.upload) this.upload.cancel();
    };

    renderSummary(){
        const { photos, unsupported } = this.state;
        const others = this.props.files.ignored.length;
        let text = interpolate(_("%(count)s thermal photos."), {count: photos.length});
        if (unsupported.length) text += " " + interpolate(_("%(count)s photos of a camera this plugin cannot convert are left out."), {count: unsupported.length});
        if (others) text += " " + interpolate(this.keepsPhotos() ? _("%(count)s other files (RGB photos, ...) go only in the dataset.") :
                                              _("%(count)s other files (RGB photos, ...) are ignored."), {count: others});
        return (
            <React.Fragment>
                <p>{text} <span className="text-muted">{_("To check the flight first or compare settings, use the")}{" "}
                    <a href="/plugins/dji-thermal/">{_("DJI Thermal Analyzer")}</a>.</span></p>
                <p className="help-block">{this.state.frames.normalize ?
                    _("WebODM's options below start as the plan's (radiometric-calibration none). Left so, the task also gets the plan's orthophoto resolution and GPS accuracy, from the photos' analysis, before it starts.") :
                    _("WebODM's options below start as the plan's (radiometric-calibration none). Normalized or harmonized, the task also gets its orthophoto resolution and GPS accuracy, from the photos' analysis.")}</p>
            </React.Fragment>
        );
    }

    renderProgress(){
        const p = this.state.progress;
        const percent = p.total ? Math.round(p.done / p.total * 100) : 100;
        return (
            <div className="dji-thermal-progress">
                <p>{interpolate(p.uploading ? _("Uploading %(done)s of %(total)s photos") : _("Converting %(done)s of %(total)s thermal photos"), {done: p.done, total: p.total})}
                    {p.failed.length ? " " + interpolate(_("(%(count)s failed)"), {count: p.failed.length}) : ""}</p>
                <div className="progress">
                    <div className="progress-bar progress-bar-striped active" role="progressbar" style={{width: percent + "%"}}>{percent}%</div>
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={this.handleCancelUpload}>
                    <i className="glyphicon glyphicon-remove-circle"></i> {_("Cancel Upload")}
                </button>
            </div>
        );
    }

    render(){
        const { phase, combined, error } = this.state;
        const uploading = phase === "uploading";

        return (
            <div className="dji-thermal-task-panel">
                {error ? <div className="alert alert-warning">{error}</div> : ""}

                {phase === "describing" ?
                    <div className="new-task-panel theme-background-highlight">
                        <i className="fa fa-circle-notch fa-spin fa-fw"></i> {_("Reading the thermal photos…")}
                    </div>
                : ""}

                {phase !== "describing" && !combined ?
                    <button type="button" className="btn btn-default btn-sm" onClick={this.props.onCancel}>{_("Close")}</button>
                : ""}

                {uploading ? this.renderProgress() : ""}

                {phase !== "describing" && combined ?
                    <div className={uploading ? "hide" : ""}>
                        <div className="new-task-panel theme-background-highlight form-horizontal dji-thermal-measurement-panel">
                            {this.renderSummary()}
                            {this.renderPalette()}
                            {this.renderFrames()}
                            <MeasurementSettings combined={combined} values={this.state.values} unit={this.state.unit}
                                errors={this.state.errors} onChange={this.handleValuesChange} onUnitChange={this.handleUnitChange} />
                            <div className="checkbox">
                                <label>
                                    <input type="checkbox" name="keepPhotos" checked={this.keepsPhotos()} disabled={this.state.frames.normalize}
                                           onChange={e => this.setState({keepPhotos: e.target.checked})} />
                                    {" "}{_("Also keep the photos in a DJI Thermal Analyzer dataset")}
                                </label>
                                <span className="help-block">{_("The task is also a dataset, with every photo picked (the RGB ones too): to check the flight or try other conversion settings. The photos are sent once.")}</span>
                            </div>
                        </div>
                        <NewTaskPanel
                            ref={this.handleNewTaskPanel}
                            onSave={this.handleSave}
                            onCancel={this.props.onCancel}
                            suggestedTaskName={this.suggestedTaskName}
                            filesCount={this.getFiles().length}
                            showResize={false}
                            showAlign={false}
                            projectId={this.props.projectId}
                            getFiles={this.getFiles}
                        />
                    </div>
                : ""}
            </div>
        );
    }
}

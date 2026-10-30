import React from 'React';
import PropTypes from 'prop-types';
import { _, interpolate } from 'webodm/classes/gettext';
import { FIELDS, UNITS, rangeText, recordedText } from './measurement';

// The Measurement section of a thermal task: the parameters the photos are measured with. Each field shows the
// recorded value as its placeholder: left empty, every photo keeps its own.
export default class MeasurementSettings extends React.Component {
    static propTypes = {
        combined: PropTypes.object.isRequired, // measurement.combineCameras()
        values: PropTypes.object.isRequired,
        unit: PropTypes.string.isRequired,
        errors: PropTypes.object.isRequired,
        disabled: PropTypes.bool,
        onChange: PropTypes.func.isRequired, // (values)
        onUnitChange: PropTypes.func.isRequired // (unit)
    };

    setValue = name => e => {
        this.props.onChange(Object.assign({}, this.props.values, {[name]: e.target.value}));
    };

    fieldHelp(name){
        const { combined, unit } = this.props;
        const parts = [];
        const recorded = recordedText(name, combined, unit);
        if (recorded !== "") parts.push(interpolate(_("Recorded: %(value)s"), {value: recorded}));
        parts.push(interpolate(_("Range: %(range)s"), {range: rangeText(name, combined, unit)}));
        const unused = combined.unusedBy[name];
        if (unused) parts.push(interpolate(_("Not used by the %(cameras)s"), {cameras: unused.join(", ")}));
        return parts.join(". ");
    }

    renderError(name){
        const error = this.props.errors[name];
        return error ? <span className="help-block dji-thermal-error">{error}</span> : "";
    }

    renderField(field){
        const { combined, values, unit, errors, disabled } = this.props;
        const recorded = recordedText(field.name, combined, unit);
        const suffix = field.temperature ? UNITS[unit] : (field.suffix || "");
        return (
            <div key={field.name} className={"form-group " + (errors[field.name] ? "has-error" : "")}>
                <label className="col-sm-2 control-label" htmlFor={"dji-thermal-" + field.name}>{_(field.label)}</label>
                <div className="col-sm-10">
                    <div className={suffix ? "input-group dji-thermal-input" : "dji-thermal-input"}>
                        <input id={"dji-thermal-" + field.name} type="number" step={field.step} className="form-control"
                               placeholder={recorded !== "" ? interpolate(_("As recorded (%(value)s)"), {value: recorded}) : _("As recorded")}
                               value={values[field.name] || ""} disabled={disabled} onChange={this.setValue(field.name)} />
                        {suffix ? <span className="input-group-addon">{suffix}</span> : ""}
                    </div>
                    {this.renderError(field.name)}
                    <span className="help-block">{this.fieldHelp(field.name)}</span>
                </div>
            </div>
        );
    }

    render(){
        const { combined, values, unit, errors, disabled } = this.props;
        const distanceMode = values.distanceMode || "lrf";
        const unusedByAll = FIELDS.filter(f => !combined.ranges[f.name] && combined.unusedBy[f.name]);

        return (
            <div className="dji-thermal-measurement">
                <p><strong>{_("Measurement")}</strong> &mdash; {interpolate(_("The values the temperatures are computed with. Left empty, each photo keeps the value its camera recorded (%(cameras)s)."), {cameras: combined.cameras.join(", ")})}</p>

                <div className="form-group">
                    <label className="col-sm-2 control-label" htmlFor="dji-thermal-unit">{_("Temperature unit")}</label>
                    <div className="col-sm-10">
                        <select id="dji-thermal-unit" className="form-control dji-thermal-input" value={unit} disabled={disabled}
                                onChange={e => this.props.onUnitChange(e.target.value)}>
                            <option value="C">{_("Celsius")} ({UNITS.C})</option>
                            <option value="F">{_("Fahrenheit")} ({UNITS.F})</option>
                            <option value="K">{_("Kelvin")} ({UNITS.K})</option>
                        </select>
                        <span className="help-block">{_("For the values below. The task's images are always in degrees Celsius.")}</span>
                    </div>
                </div>

                {FIELDS.filter(f => combined.ranges[f.name]).map(f => this.renderField(f))}

                {unusedByAll.map(f =>
                    <div key={f.name} className="form-group">
                        <label className="col-sm-2 control-label">{_(f.label)}</label>
                        <div className="col-sm-10"><p className="form-control-static">{interpolate(_("Not used by the %(cameras)s"), {cameras: combined.unusedBy[f.name].join(", ")})}</p></div>
                    </div>
                )}

                <div className={"form-group " + (errors.distance ? "has-error" : "")}>
                    <label className="col-sm-2 control-label" htmlFor="dji-thermal-distance-mode">{_("Distance")}</label>
                    <div className="col-sm-10">
                        <select id="dji-thermal-distance-mode" className="form-control dji-thermal-input" value={distanceMode}
                                disabled={disabled} onChange={this.setValue("distanceMode")}>
                            <option value="lrf">{_("Laser rangefinder, else as recorded")}</option>
                            <option value="embedded">{_("As recorded")}</option>
                            <option value="value">{_("Set for all photos")}</option>
                        </select>
                        {distanceMode === "value" ?
                            <div className="input-group dji-thermal-input dji-thermal-distance">
                                <input id="dji-thermal-distance" type="number" step="0.1" className="form-control"
                                       value={values.distance || ""} disabled={disabled} onChange={this.setValue("distance")} />
                                <span className="input-group-addon">m</span>
                            </div>
                        : ""}
                        {this.renderError("distance")}
                        <span className="help-block">{distanceMode === "lrf" ?
                            _("Each photo's laser rangefinder distance where it has a valid one, else the distance its camera recorded.") + " " : ""}
                            {interpolate(_("Range: %(range)s"), {range: rangeText("distance", combined, unit)})}</span>
                    </div>
                </div>
            </div>
        );
    }
}

import React from 'React';
import ReactDOM from 'ReactDOM';
import PropTypes from 'prop-types';
import { _, interpolate } from 'webodm/classes/gettext';
import ThermalTaskPanel from './ThermalTaskPanel';
import { sortFiles } from './rjpeg';
import './ThermalTask.scss';

// The DJI Thermal Task button beside a project's "Select Images and GCP" (PluginsAPI.Dashboard.addNewTaskButton). The
// photos picked are sorted in the browser (rjpeg.js) and the thermal task's panel opens where WebODM's own does:
// at the top of the project's content, below its buttons.
export default class ThermalTaskButton extends React.Component {
    static propTypes = {
        projectId: PropTypes.number.isRequired,
        onNewTaskAdded: PropTypes.func.isRequired
    };

    constructor(props){
        super(props);
        this.state = {files: null, sorting: false, result: null};
        this.container = document.createElement("div");
        this.container.className = "dji-thermal-container";
    }

    componentDidMount(){
        // The project item's second row, where WebODM shows its upload's panel
        const item = this.button && this.button.closest(".project-list-item");
        const row = item && Array.from(item.children).find(c => c.classList.contains("row") && !c.classList.contains("no-margin"));
        if (row) row.insertBefore(this.container, row.firstChild);
    }

    componentWillUnmount(){
        if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
    }

    handleClick = () => {
        if (this.state.files) return; // a thermal task is already open
        this.input.value = "";
        this.input.click();
    };

    handleFilesPicked = e => {
        const picked = Array.from(e.target.files || []);
        if (!picked.length) return;
        this.setState({sorting: true, result: null});
        sortFiles(picked).then(files => this.setState({files, sorting: false}));
    };

    handleTaskAdded = result => {
        this.setState({files: null, result});
        this.props.onNewTaskAdded();
    };

    handleCancel = () => {
        this.setState({files: null});
    };

    renderResult(){
        const r = this.state.result;
        const problems = r.failed.concat(r.ignored);
        return (
            <div className={"alert alert-dismissible " + (r.failed.length ? "alert-warning" : "alert-info")}>
                <button type="button" className="close" title={_("Close")} onClick={() => this.setState({result: null})}><span aria-hidden="true">&times;</span></button>
                {interpolate(_("Thermal task created with %(count)s images."), {count: r.converted.length})}
                {r.failed.length ? " " + interpolate(_("%(count)s photos could not be converted:"), {count: r.failed.length}) : ""}
                {problems.length ?
                    <ul>{problems.slice(0, 20).map(p => <li key={p.name}>{p.name}: {p.reason}</li>)}
                        {problems.length > 20 ? <li>{interpolate(_("and %(count)s more"), {count: problems.length - 20})}</li> : ""}</ul>
                : ""}
            </div>
        );
    }

    render(){
        const { files, sorting, result } = this.state;
        return (
            <React.Fragment>
                <button type="button" className="btn btn-default btn-sm dji-thermal-button" disabled={sorting || !!files}
                        onClick={this.handleClick} ref={b => { this.button = b; }}
                        title={_("Create a task of temperature images from DJI thermal photos")}>
                    <i className={sorting ? "fa fa-circle-notch fa-spin" : "fa fa-thermometer-half"}></i>
                    <span className="hidden-xs"> {_("DJI Thermal Task")}</span>
                </button>
                <input type="file" multiple accept=".jpg,.jpeg,.txt" className="hide" ref={i => { this.input = i; }}
                       onChange={this.handleFilesPicked} />
                {ReactDOM.createPortal(
                    <React.Fragment>
                        {result ? this.renderResult() : ""}
                        {files ? <ThermalTaskPanel projectId={this.props.projectId} files={files}
                                                   onTaskAdded={this.handleTaskAdded} onCancel={this.handleCancel} /> : ""}
                    </React.Fragment>,
                    this.container)}
            </React.Fragment>
        );
    }
}

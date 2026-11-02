import React from 'React';
import PropTypes from 'prop-types';
import { _, interpolate } from 'webodm/classes/gettext';
import serverApi from './serverApi';
import { POLL_MS, worksetState } from './worksetProgress';

// A DJI Thermal Task's photos being normalized or harmonized, until the task starts: in the message once the task is
// created (ThermalTaskButton) and in the task's panel after the page is refreshed (main.js). It asks the server every
// few seconds; a task without such a workset shows nothing.
export default class WorksetProgress extends React.Component {
    static propTypes = {
        projectId: PropTypes.number.isRequired,
        taskId: PropTypes.string.isRequired,
        onStarted: PropTypes.func
    };

    constructor(props){
        super(props);
        this.state = {workset: null, error: null, none: false, starting: false};
    }

    componentDidMount(){
        // In a task's panel, a line of its own above the panel's other buttons (main.js adds it first)
        const wrapper = this.root && this.root.parentNode;
        if (wrapper && wrapper.parentNode && wrapper.parentNode.classList.contains("plugin-action-buttons")) wrapper.style.display = "block";
        this.poll();
    }

    componentWillUnmount(){
        this.unmounted = true;
        clearTimeout(this.timer);
    }

    poll = () => {
        serverApi.worksetProgress(this.props.projectId, this.props.taskId).then(workset => {
            if (this.unmounted) return;
            this.setState({workset, error: null});
            const state = worksetState(workset);
            if (!state.done) this.timer = setTimeout(this.poll, POLL_MS);
            else if (state.kind === "started" && this.props.onStarted) this.props.onStarted();
        }, e => {
            if (this.unmounted) return;
            if (e.status === 404) this.setState({none: true});
            else {
                this.setState({error: e.message});
                this.timer = setTimeout(this.poll, POLL_MS * 5);
            }
        });
    };

    handleStart = () => {
        this.setState({starting: true, error: null});
        serverApi.startWorksetTask(this.props.projectId, this.props.taskId).then(workset => {
            if (this.unmounted) return;
            this.setState({workset, starting: false});
            if (this.props.onStarted) this.props.onStarted();
        }, e => {
            if (!this.unmounted) this.setState({starting: false, error: e.message});
        });
    };

    text(state, photos){
        switch (state.kind){
        case "waiting": return interpolate(_("Waiting for WebODM's worker to convert %(count)s thermal photos…"), {count: photos});
        case "converting": return interpolate(_("Converting %(count)s thermal photos: %(progress)s…"),
                                              {count: photos, progress: state.stage || state.percent + "%"});
        case "committing": return _("Converted: putting the images in the task…");
        case "started": return <React.Fragment><i className="fa fa-check"></i> <strong>{_("Complete!")}</strong> {_("The task is processing in WebODM.")}</React.Fragment>;
        case "not_started": return interpolate(_("Converted, but the task didn't start: %(error)s"), {error: state.error});
        case "failed": return interpolate(_("The conversion failed: %(error)s"), {error: state.error});
        default: return _("The conversion was canceled: the task will not start.");
        }
    }

    render(){
        const { workset, error, none, starting } = this.state;
        if (none) return <span ref={r => { this.root = r; }}></span>;
        if (!workset) return <div className="dji-thermal-workset-progress" ref={r => { this.root = r; }}>{error ? interpolate(_("Cannot tell how far the conversion is: %(error)s"), {error}) : _("Asking how far the conversion is…")}</div>;
        const state = worksetState(workset);
        // Normalizing compares the frames before any is written: its stages move a full bar, with no percentage. Done:
        // the theme's success colour, as WebODM's Completed (its progress-bar-success is the link colour)
        const staged = state.stage && !state.percent;
        const started = state.kind === "started";
        return (
            <div className="dji-thermal-workset-progress" ref={r => { this.root = r; }}>
                {state.percent !== undefined ?
                    <div className="progress">
                        <div className={"progress-bar " + (started ? "progress-bar-success theme-background-success" : "progress-bar-striped active")} role="progressbar"
                             style={{width: (staged ? 100 : state.percent) + "%"}}
                             aria-valuenow={staged ? undefined : state.percent} aria-valuemin="0" aria-valuemax="100">
                            {staged || started ? "" : state.percent + "%"}</div>
                    </div> : ""}
                <div className={started ? "text-success" : ""}>{this.text(state, workset.photos)}</div>
                {state.kind === "not_started" ?
                    <button type="button" className="btn btn-sm btn-primary dji-thermal-workset-start" disabled={starting} onClick={this.handleStart}
                            title={_("Put the converted images in the task and start it again")}>
                        <i className={starting ? "fa fa-circle-notch fa-spin" : "fa fa-play"}></i> {_("Start processing")}
                    </button> : ""}
                {error ? <div className="text-warning">{interpolate(_("Cannot tell how far the conversion is: %(error)s"), {error})}</div> : ""}
                {!state.done ? <div className="help-block">{_("You can refresh or close this page: WebODM's worker converts the photos, then starts the task. Don't use WebODM's Start Processing meanwhile: it would process the photos unconverted.")}</div> : ""}
            </div>
        );
    }
}

import { createContext, ParentProps, useContext } from "solid-js";
import createViewPortAxis, { AxisState, ViewPortAxis } from "./createViewPortAxis";

// A viewport is a set of named axes. `<ViewPort>` builds one axis per entry and
// publishes them on context so descendants (scroll container, scrollbars, the
// content) read the same live scaler. Nesting composes — inner axes add to the
// outer set, so a pane can introduce a local axis without losing its parent's.
export const ViewPort = (
  props: ParentProps<{
    axes: Record<string, () => Omit<AxisState, "name">>;
  }>,
) => {
  const axes = Object.entries(props.axes).map(([name, getState]) =>
    createViewPortAxis(() => ({ name, ...getState() })),
  );

  const parent = useContext(ViewPortContext);

  return (
    <ViewPortContext.Provider value={[...parent, ...axes]}>
      {props.children}
    </ViewPortContext.Provider>
  );
};

const ViewPortContext = createContext<ViewPortAxis[]>([]);

// Grab an axis by name (or the innermost axis when name is omitted).
export const useAxis = (name?: string): ViewPortAxis => {
  const axes = useContext(ViewPortContext);
  const axis = name ? axes.find((a) => a.name === name) : axes[axes.length - 1];
  if (!axis) throw new Error(`ViewPort axis "${name ?? "(default)"}" not found.`);
  return axis;
};

export const useAxes = () => useContext(ViewPortContext);

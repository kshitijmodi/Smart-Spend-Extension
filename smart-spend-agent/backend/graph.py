"""
LangGraph workflow definition for the SmartSpend agent system.

Graph topology
--------------

    context_agent
         |
    profile_agent
         |
    financial_agent
         |
    sentiment_agent
         |
    supervisor_agent
         |
        END
"""

from langgraph.graph import StateGraph, END

from backend.state import AgentState
from backend.agents.context_agent import context_agent
from backend.agents.profile_agent import profile_agent
from backend.agents.financial_agent import financial_agent
from backend.agents.sentiment_agent import sentiment_agent
from backend.agents.supervisor_agent import supervisor_agent


def build_graph() -> StateGraph:
    """
    Constructs and compiles the LangGraph StateGraph.

    Returns a compiled graph that accepts an AgentState dict and
    produces an updated AgentState dict as output.
    """
    graph = StateGraph(AgentState)

    # ---- Register nodes ----
    graph.add_node("context_agent", context_agent)
    graph.add_node("profile_agent", profile_agent)
    graph.add_node("financial_agent", financial_agent)
    graph.add_node("sentiment_agent", sentiment_agent)
    graph.add_node("supervisor_agent", supervisor_agent)

    # ---- Entry point ----
    graph.set_entry_point("context_agent")

    # ---- Edges (fully sequential) ----
    graph.add_edge("context_agent", "profile_agent")
    graph.add_edge("profile_agent", "financial_agent")
    graph.add_edge("financial_agent", "sentiment_agent")
    graph.add_edge("sentiment_agent", "supervisor_agent")
    graph.add_edge("supervisor_agent", END)

    return graph.compile()


# Module-level compiled graph (imported by main.py)
workflow = build_graph()
